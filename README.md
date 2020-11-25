# Introduction 
When you redeploy your step functions into localstack environment with the serverless framework most likely it will ignore your changes.
Use this script as npm hook to fix the issue.

# Getting Started
###Prerequisites
- Docker
- Localstack available on edge port
- aws-cli
- node.js
- npm 

###Install npm module
```bash
npm install -SD sf-fix
```
###Add a hook to you package.json

```json
...
"deploy:localstack": "sls deploy --stage local",
"postdeploy:localstack": "st-fix"
...
``` 

##Debug and dry run
To debug the module please provide `DEBUG=true` environment variable, or it can be used along with `DRY_RUN=true` variable in order to print execution command.   
