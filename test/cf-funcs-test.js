const assert = require('assert');
const sinon = require('sinon');
const funcs = require('../lib/cf-funcs');
const spylogger = require('./spy-logger');
const STACK_NAME = 'mock-stack'

var cloudFormation = require('./mock-aws');

function prepStackExistsException() {
  cloudFormation.createStackAsync.restore();
  sinon.stub(cloudFormation, 'createStackAsync', (params) => {
    return new Promise((resolve, reject) => {
      reject({cause:{code: 'AlreadyExistsException'}})
    })
  });
}

// TODO refactor this since order of the runs currently matters due to the createStackAsync.restore call
const happyPathRuns = [
  {func: funcs.createStack, action: 'CREATE', cfFuncName: 'createStackAsync'},
  {func: funcs.updateStack, action: 'UPDATE', cfFuncName: 'updateStackAsync'},
  {func: funcs.deleteStack, action: 'DELETE', cfFuncName: 'deleteStackAsync'},
  {func: funcs.createOrUpdateStack, action: 'CREATE', cfFuncName: 'createStackAsync', descAddendum: 'when create is successful'},
  {func: funcs.createOrUpdateStack, action: 'UPDATE', cfFuncName: 'updateStackAsync', descAddendum: 'when stack already exists', before: prepStackExistsException}
]

describe('cf-funcs', function() {
  before(function() {
    process.env.AWS_CF_MONITOR_DELAY = '1'
  })

  beforeEach(function() {
    describeStackEventsAsyncStub = sinon.stub(cloudFormation, 'describeStackEventsAsync');
    spylogger.reset();
  })

  afterEach(function() {
    describeStackEventsAsyncStub.restore();
    cloudFormation.createStackAsync.reset();
    cloudFormation.updateStackAsync.reset();
    cloudFormation.deleteStackAsync.reset();
  })

  happyPathRuns.forEach(function(run){
    describe(`#${run.func.name}`, function(){
      if(run.before) {
        beforeEach(run.before)
      }

      it(`should wait for completion of ${run.cfFuncName} and log events ${run.descAddendum || ''}`, function() {
        const inProgressEvent = {
          StackEvents: [
            {
              EventId: '1a2b3c4d',
              StackName: STACK_NAME,
              LogicalResourceId: STACK_NAME,
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: `${run.action}_IN_PROGRESS`
            }
          ]
        };
        const completedEvent = {
          StackEvents: [
            {
              EventId: '1e2f3g4h',
              StackName: STACK_NAME,
              LogicalResourceId: STACK_NAME,
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: `${run.action}_COMPLETE`
            }
          ]
        };
        describeStackEventsAsyncStub.onCall(0).returns(Promise.resolve(inProgressEvent));
        describeStackEventsAsyncStub.onCall(1).returns(Promise.resolve(completedEvent));
        return run.func({StackName: STACK_NAME}, cloudFormation)
          .then(function(finalStatus){
            assert.equal(finalStatus, `${run.action}_COMPLETE`);
            assert.equal(describeStackEventsAsyncStub.callCount, 2);
            assert.ok(describeStackEventsAsyncStub.calledWithExactly({StackName: STACK_NAME}));
            assert.equal(cloudFormation[run.cfFuncName].callCount, 1);
            assert.ok(cloudFormation[run.cfFuncName].calledWithExactly({StackName: STACK_NAME}));
            // 1 INFO at the beginning and the end, then 1 for each event
            assert.equal(spylogger.callCount, 4);
          });
      });
    });
  });

  describe('#createOrUpdateStack', () => {
    it('should reject when creating the stack fails for unknown reason', () => {
      cloudFormation.createStackAsync.restore();
      sinon.stub(cloudFormation, 'createStackAsync', (params) => {
        return new Promise((resolve, reject) => {
          reject({cause:{code: 'BLAH'}})
        })
      });
      funcs.createOrUpdateStack({StackName: STACK_NAME}, cloudFormation)
        .then(
          (result) => {
            throw new Error('createOrUpdateStack should not resolve')
          },
          (err) => assert.equal(err.cause.code, 'BLAH')
        )
    })
  })

});
