import {MetricsServerManager} from '../../src/MetricsServerManager';
import {MetricsClient} from '../../src/MetricsClient';
import {expect} from 'chai';
import {Counter as CounterProxy, Gauge as GaugeProxy, Timer as TimerProxy, Histogram as HistogramProxy, Meter as MeterProxy} from '../../src/client/index';
import {MetricName, BaseCounter, BaseGauge, BaseHistogram, BaseMeter, BaseTimer} from '../../src/common/index';
import {MetricsConstants} from '../../src/MetricsConstants';
const debug = require('debug')('pandora:metrics:test');

describe('/test/unit/MetricsServerManager.test.ts', () => {

  let server = new MetricsServerManager();
  let client = new MetricsClient();

  before((done) => {
    setTimeout(done, 100);
  });

  after(() => {
    server.destroy();
    server = null;
  });

  it('test server base method', () => {
    expect(server.isEnabled()).to.be.true;
    server.setEnabled(false);
    expect(server.isEnabled()).to.be.false;
    server.setEnabled(true);
    server.setLogger(console);

    expect(server.getGauges('empty').size).to.be.equal(0);
    expect(server.getHistograms('empty').size).to.be.equal(0);
    expect(server.getCounters('empty').size).to.be.equal(0);
    expect(server.getTimers('empty').size).to.be.equal(0);
    expect(server.getMeters('empty').size).to.be.equal(0);
  });

  it('create a new client and register it', () => {
    expect(server.getClients().length > 0).to.be.true;
    expect(server.getClients()[0]['_APP_NAME']).to.exist;
    expect(server.getClients()[0]['_CLIENT_ID']).to.exist;
  });


  it('register counter metric', (done) => {
    let counter = new CounterProxy();
    let name = MetricName.build('test.qps.count');
    client.register('test', name, counter);
    counter.inc(5);
    counter.inc(5);
    counter.inc(5);
    counter.inc(5);

    setTimeout(() => {
      debug('invoke');
      expect((<BaseCounter>server.getMetric(name.tagged({
        appName: MetricsConstants.METRICS_DEFAULT_APP,
      }))).getCount()).to.be.equal(20);
      done();
    }, 10);
  });

  it('register gauge metric', async () => {
    let name = MetricName.build('test.qps.qps');
    client.register('test', name, <GaugeProxy<number>> {
      getValue() {
        return 100;
      }
    });

    setTimeout(async () => {
      debug('invoke');

      let result = await (<BaseGauge<any>>server.getMetric(name.tagged({
        appName: MetricsConstants.METRICS_DEFAULT_APP,
      }))).getValue();

      expect(result).to.be.equal(100);
    }, 10);
  });

  it('register other metric', () => {
    let timer = new TimerProxy();
    client.register('test_extra', MetricName.build('test.qps.timer'), timer);

    let histogram = new HistogramProxy();
    client.register('test_extra', MetricName.build('test.qps.histogram'), histogram);

    let meter = new MeterProxy();
    client.register('test_extra', MetricName.build('test.qps.meter'), meter);
  });


  it('register metric from server and client', (done) => {
    client.register('test1', MetricName.build('reporter.register.client.uv'), new CounterProxy());
    client.register('test2', MetricName.build('reporter.register.client.cpu'), <GaugeProxy<number>> {
      getValue() {
        return 100;
      }
    });

    server.register('test1', MetricName.build('reporter.register.pv'), new BaseCounter());
    server.register('test2', MetricName.build('reporter.register.mem'), <BaseGauge<number>> {
      getValue() {
        return 1;
      }
    });

    setTimeout(() => {
      debug(server.listMetricGroups());
      expect(server.listMetricGroups().length > 2).to.be.true;
      debug(server.getCategoryMetrics('test1'));
      expect(server.getCounters('test1').size).to.be.equal(2);
      done();
    }, 10);
  });

  it('test get metric method', () => {
    const counter = server.getCounter('middleware', MetricName.build('reporter.test.counter'));
    expect(counter).to.be.an.instanceof(BaseCounter);

    const histogram = server.getHistogram('middleware', MetricName.build('reporter.test.histogram'));
    expect(histogram).to.be.an.instanceof(BaseHistogram);

    const timer = server.getTimer('middleware', MetricName.build('reporter.test.timer'));
    expect(timer).to.be.an.instanceof(BaseTimer);

    const meter = server.getMeter('middleware', MetricName.build('reporter.test.meter'));
    expect(meter).to.be.an.instanceof(BaseMeter);

    expect(server.listMetricNamesByGroup().size > 0).to.be.true;
    expect(server.listMetricNamesByGroup().get('middleware').length).to.be.equal(4);
    expect(server.getAllCategoryMetrics().size).to.be.equal(5);
  });


});
