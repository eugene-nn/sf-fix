#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';
const SERVERLESS_DIR = process.env.SERVERLESS_DIR || '.serverless';
const CF_FILE = process.env.CF_FILE || 'cloudformation-template-update-stack.json';

const cloudformationPath = path.resolve() + `/${SERVERLESS_DIR}/${CF_FILE}`;

if (!fs.existsSync(cloudformationPath)) {
  console.error(
    'Seems like your cloudformation template does not exists.' +
    '\nCheck path: ' + cloudformationPath +
    '\nTerminating process...',
  );
  process.exit(-1);
}

const cloudformationStack = require(cloudformationPath);

const cmdLambdaList = [
  'aws',
  '--endpoint-url http://localhost:4566',
  'lambda list-functions',
].join(' ');

const cmdStateMachineList = [
  'aws',
  '--endpoint-url http://localhost:4566',
  'stepfunctions list-state-machines',
].join(' ');

const getCommand = (item) => [
  `aws`,
  `--endpoint-url http://localhost:4566`,
  `stepfunctions update-state-machine`,
  `--state-machine-arn ${item.stateMachineArn}`,
  `--definition '${JSON.stringify(item.mergedStateMachineDefinition)}'`,
].join(' ');

const getResourceByType = (type, obj) => {
  return Object.keys(obj.Resources).reduce((a, v) => {
    if (obj.Resources[`${v}`].Type === type) {
      a.push({ name: v, definition: obj.Resources[`${v}`] });
    }
    return a;
  }, []);
};

const getResourceByName = (name, obj) => obj.Resources[`${name}`];

const getFunctionArn = async (functionName) => {
  let awsCliLambdaR = {};
  const { stdout, stderr } = await exec(cmdLambdaList);
  try {
    awsCliLambdaR = JSON.parse(stdout);
  } catch (e) {
    console.error(e.message);
    process.exit(-1);
  }

  let functionArn = '';
  if (awsCliLambdaR && awsCliLambdaR.Functions) {
    functionArn = awsCliLambdaR.Functions.find(f => f.FunctionName === functionName).FunctionArn;
  }
  return functionArn;
};

const getStateMachineArn = async (stateMachineName) => {
  let awsCliStateMachinesR = {
    stateMachines: false,
  };
  const { stdout, stderr } = await exec(cmdStateMachineList);
  try {
    awsCliStateMachinesR = JSON.parse(stdout);
  } catch (e) {
    console.error(e.message);
    process.exit(-1);
  }

  let stateMachine = '';
  if (
    awsCliStateMachinesR &&
    awsCliStateMachinesR.stateMachines &&
    awsCliStateMachinesR.stateMachines.length !== 0
  ) {
    stateMachine = awsCliStateMachinesR.stateMachines.find(f => f.name.toLowerCase() === stateMachineName);
  }

  return stateMachine;
};

const stateMachines = getResourceByType('AWS::StepFunctions::StateMachine', cloudformationStack);

(async () => {
  const execList = await Promise.all(stateMachines.map(async stateMachine => {
    let mergedStateMachineDefinition = {};
    let awsStateMachine = await getStateMachineArn(stateMachine.name.toLowerCase());

    if (!awsStateMachine) {
      console.log(`State machine ${stateMachine.name} has not been deployed. \nTerminating...`);
      process.exit(0);
    }

    const stateMachineArn = awsStateMachine.stateMachineArn;
    const definition = stateMachine.definition.Properties.DefinitionString;

    let definitionString = '';
    if (typeof definition === 'string') {
      definitionString = definition;
    } else if (typeof definition === 'object') {
      definitionString = definition['Fn::Sub'][0];
      const substitutes = definition['Fn::Sub'].slice(1, definition['Fn::Sub'].length);

      if (DEBUG) {
        console.log('Cloudformation state machine:\n' + definitionString);
      }

      for (const substitute of substitutes) {
        for (const s in substitute) {
          const recourseName = substitute[`${s}`]['Fn::GetAtt'][0];
          const functionName = getResourceByName(recourseName, cloudformationStack).Properties.FunctionName;
          const functionArn = await getFunctionArn(functionName);
          const regex = new RegExp(`\\$\\{${s}\\}`, 'g');
          definitionString = definitionString.replace(regex, functionArn);
        }
      }

      if (DEBUG) {
        console.log('Generated state machine:\n' + definitionString);
      }
    }

    mergedStateMachineDefinition = JSON.parse(definitionString);

    return {
      mergedStateMachineDefinition,
      stateMachineArn,
      name: stateMachine.name,
    };
  }));


  for (const item of execList) {
    const updateCommand = getCommand(item);
    if (DRY_RUN) {
      console.log('Generated command: \n' + updateCommand);
      continue;
    }

    try {
      const { stdout } = await exec(updateCommand);
      const result = JSON.parse(stdout);
      console.log(`State machine ${item.name} successfully updated at ${result.updateDate}`);
    } catch (e) {
      console.error(e.message);
    }
  }

})();