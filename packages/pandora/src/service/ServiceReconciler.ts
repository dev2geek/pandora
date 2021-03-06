'use strict';
import * as $ from 'pandora-dollar';
import {
  ServiceWorkMode, ServiceRepresentation, ServiceInstanceReference,
  DepInstances, Service, ProcessRepresentation
} from '../domain';
import assert = require('assert');
import {MessengerClient, MessengerServer, default as Messenger} from 'pandora-messenger';
import {SOCKET_FILE_NAME} from '../const';
import {ServiceCoreFactory} from './ServiceCoreFactory';
import {WorkerContext} from '../application/WorkerContext';

const debug = require('debug')('pandora:ServiceReconciler');

/**
 * Class ServiceReconciler
 */
export class ServiceReconciler {

  protected context: WorkerContext;

  protected services: Map<string, ServiceInstanceReference> = new Map;
  protected state: 'notBoot' | 'booting' | 'booted' | 'stoping' = 'notBoot';

  protected messengerServer: MessengerServer;
  protected messengerClient: MessengerClient;
  protected processRepresentation: ProcessRepresentation;
  protected workModeByForce;

  get workMode(): ServiceWorkMode {
    if (this.workModeByForce !== undefined) {
      return this.workModeByForce;
    }
    return this.processRepresentation.processName === 'agent' ? 'agent' : 'worker';
  }

  constructor(processRepresentation: ProcessRepresentation, context, workModeByForce?) {
    this.workModeByForce = workModeByForce;
    this.processRepresentation = processRepresentation;
    this.context = context;
    if (this.workMode === 'agent') {
      this.messengerServer = Messenger.getServer({
        name: SOCKET_FILE_NAME
      });
    } else if (this.workMode === 'worker') {
      this.messengerClient = Messenger.getClient({
        name: SOCKET_FILE_NAME
      });
    } else if (this.workMode === null) {
      this.messengerServer = Messenger.getServer({
        name: $.genereateUUID()
      });
    }
  }

  /**
   * Receive a service representation
   * @param {ServiceRepresentation} serviceRepresentation
   */
  public receiveServiceRepresentation(serviceRepresentation: ServiceRepresentation) {
    debug('receiveServiceRepresentation() %j', serviceRepresentation);
    const id = serviceRepresentation.serviceName;
    if (this.services.has(id)) {
      return;
    }
    const ref: ServiceInstanceReference = {
      serviceRepresentation: serviceRepresentation,
      state: 'noinstance'
    };
    this.services.set(serviceRepresentation.serviceName, ref);
  }

  /**
   * Get ordered service id set, order by service weight
   * @param {"asc" | "desc"} order
   * @return {Array}
   */
  public getOrderedServiceIdSet(order: 'asc' | 'desc') {
    const ret = [];
    for (const id of this.services.keys()) {
      ret.push({id, weight: this.getWeight(id)});
    }
    return ret.sort((a, b) => {
      if (order === 'asc') {
        return a.weight - b.weight;
      } else {
        return b.weight - a.weight;
      }
    });
  }

  /**
   * Get service's weight by service's ID (name)
   * @param id
   * @param {string[]} chain
   * @return {any}
   */
  public getWeight(id, chain?: string[]) {
    chain = Array.from(chain || []);
    assert(-1 === chain.indexOf(id), `Service name: ${id} in a cyclic dependency chain: ${chain.join(' -> ')} -> ${id}`);
    chain.push(id);
    assert(this.services.has(id), `Could not found service id: ${id}`);
    const ref = this.services.get(id);
    const {serviceRepresentation} = ref;
    if (!serviceRepresentation.dependencies || !serviceRepresentation.dependencies.length) {
      return 1;
    } else {
      const nextLevelWeights = [];
      for (const nextId of serviceRepresentation.dependencies) {
        nextLevelWeights.push(this.getWeight(nextId, chain));
      }
      return Math.max.apply(Math, nextLevelWeights) + 1;
    }
  }

  /**
   * Instantiate all the services
   */
  public instantiate() {
    for (const {id} of this.getOrderedServiceIdSet('asc')) {

      assert(this.services.has(id), `Could not found service id: ${id}`);
      const ref = this.services.get(id);
      const {state, serviceRepresentation} = ref;

      debug('instantiateOne() request %s', id);
      if (state === 'noinstance') {

        debug('instantiateOne() instantiate %s', id);
        const deps: string[] = serviceRepresentation.dependencies;
        const depInstances: DepInstances = {};

        if (deps) {
          for (let depId of deps) {
            depInstances[depId] = this.services.get(depId).serviceCoreInstance;
          }
        }

        const serviceEntry = (<any> serviceRepresentation.serviceEntry).getLazyClass ?
          (<any> serviceRepresentation.serviceEntry).getLazyClass() : serviceRepresentation.serviceEntry;

        serviceRepresentation.config = serviceRepresentation.configResolver ?
          serviceRepresentation.configResolver(this.context.workerContextAccessor, serviceRepresentation.config)
          : serviceRepresentation.config;
        const serviceCoreInstance = new ServiceCoreFactory({
          messengerClient: this.messengerClient,
          messengerServer: this.messengerServer,
          workMode: this.workMode,
          context: this.context.workerContextAccessor,
          representation: serviceRepresentation,
          depInstances: depInstances
        }, serviceEntry);

        ref.serviceCoreInstance = serviceCoreInstance;
        ref.state = 'instanced';
        debug('instantiateOne() instanced %s', id);
      }

    }
  }

  /**
   * Start all the services
   * @return {Promise<void>}
   */
  public async start() {
    debug('start()');
    this.instantiate();
    // Maybe start mutilate times, only set state at first time
    if (this.state !== 'booted') {
      this.state = 'booting';
    }
    for (const {id} of this.getOrderedServiceIdSet('asc')) {
      assert(this.services.has(id), `Could not found service id: ${id}`);
      const ref = this.services.get(id);
      debug('startOne() instanced request %s', id);
      assert(ref.state !== 'noinstance', 'instantiate first before start ' + id);

      if (ref.state === 'instanced') {
        debug('startOne() start %s', id);
        ref.state = 'booting';
        const serviceCore = ref.serviceCoreInstance;
        // midwayClassicPluginService 中需要在启动过程中，通过 getService 获得到启动过程中的自己，提早实例产生时机
        ref.serviceInstance = serviceCore.instantiate();
        await serviceCore.start();
        ref.state = 'booted';
        debug('startOne() booted %s', id);
      }
    }
    debug('start() booted');
    this.state = 'booted';
  }

  public async stop() {
    debug('stop()');
    if (this.state === 'notBoot') {
      return;
    }
    for (const {id} of this.getOrderedServiceIdSet('desc')) {
      assert(this.services.has(id), `Could not found service id: ${id}`);
      const ref = this.services.get(id);
      debug('stopOne() instanced request %s', id);
      assert(ref.state !== 'noinstance', 'instantiate first before stop ' + id);

      if (ref.state === 'booted') {
        debug('stopOne() start %s', id);
        ref.state = 'stopping';
        const serviceCore = ref.serviceCoreInstance;
        await serviceCore.stop();
        ref.serviceInstance = serviceCore.getService();
        ref.state = 'instanced';
        debug('startOne() stopped %s', id);
      }
    }
    debug('stop() stopped');
    this.state = 'notBoot';
  }

  public get<T extends Service>(id): T {
    assert(this.services.has(id), `Could not found service id: ${id}`);
    const ref = this.services.get(id);
    assert(ref.serviceInstance, `Service id: ${id} have not instance yet`);
    return <T> ref.serviceInstance;
  }

  public getServiceClass(serviceName) {
    const ref = this.services.get(serviceName);
    if (ref) {
      const serviceRepresentation = ref.serviceRepresentation;
      const serviceEntry = (<any> serviceRepresentation.serviceEntry).getLazyClass ?
        (<any> serviceRepresentation.serviceEntry).getLazyClass() : serviceRepresentation.serviceEntry;
      return serviceEntry;
    }
    return null;
  }

  public getState() {
    return this.state;
  }

}


