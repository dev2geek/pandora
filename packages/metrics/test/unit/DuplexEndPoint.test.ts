import {expect} from 'chai';
import {MetricsConstants} from '../../src/MetricsConstants';
import {IndicatorScope} from '../../src/domain';
import {DuplexEndPoint} from '../../src/endpoint/DuplexEndPoint';
import {DuplexIndicator} from '../../src/indicator/DuplexIndicator';
import EventEmitter = require('events');

class MyEmitter extends EventEmitter {}

class MyEndPoint extends DuplexEndPoint {

  group = 'my_duplex';

  myEmitter = new MyEmitter();

  processReporter(data, reply?) {
    if(data) {
      this.myEmitter.emit('processReporter', data);
    }
  }
}

class MyIndicator extends DuplexIndicator {

  group = 'my_duplex';

  async invoke(data, builder) {

    await new Promise((resolve) => {
      setTimeout(() => {

        builder.withDetail('my_duplex.during', 15)
          .withDetail('my_duplex.start', Date.now(), IndicatorScope.SYSTEM)
          .withDetail('my_duplex.end', Date.now() + 15)
          .withDetail('my_duplex.count', 100);

        resolve();
      }, 200);
    });
  }

  registerUplink() {

  }

  testUplink(message) {
    this.report(message);
  }
}

describe('/test/unit/DuplexEndPoint.test.ts', () => {

  let myEndPoint = new MyEndPoint();
  myEndPoint.initialize();

  let myIndicator = new MyIndicator();

  it('instanceof', () => {
    expect(myEndPoint).to.be.an.instanceof(DuplexEndPoint);
  });

  it('indicator is empty when init', () => {
    expect(myEndPoint.indicators.length).to.be.equal(0);
  });

  it('indicators property size = 1 after register a indicator', (done) => {
    myIndicator.initialize();
    setTimeout(() => {
      expect(myEndPoint.indicators.length).to.be.equal(1);
      done();
    }, 100);
  });

  it('query custom EndPoint', (done) => {
    myEndPoint.invoke(MetricsConstants.METRICS_DEFAULT_APP).then((results) => {
      expect(results[0].key).to.be.equal('my_duplex.during');
      expect(results[1].key).to.be.equal('my_duplex.start');
      expect(results[2].key).to.be.equal('my_duplex.end');
      expect(results[3].key).to.be.equal('my_duplex.count');
      done();
    });
  });

  it('test send a uplink message', (done) => {
    myEndPoint.myEmitter.on('processReporter', (message) => {
      expect(message).to.be.equal('hello uplink');
      done();
    });
    myIndicator.testUplink('hello uplink');
  });

});
