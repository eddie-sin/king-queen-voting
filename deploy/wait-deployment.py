#!/usr/bin/env python3
"""Wait for a single SSM deployment and return its actual result to CI."""
import json, os, subprocess, time

for attempt in range(190):
    result = subprocess.run(['aws','ssm','get-command-invocation','--command-id',os.environ['COMMAND_ID'],'--instance-id',os.environ['INSTANCE_ID'],'--output','json'],capture_output=True,text=True)
    if result.returncode:
        if 'InvocationDoesNotExist' in result.stderr and attempt<12:
            time.sleep(5)
            continue
        raise SystemExit(result.stderr)
    invocation=json.loads(result.stdout)
    status=invocation['Status']
    if status not in ['Pending','InProgress','Delayed']:
        print('Deployment status:',status)
        print(invocation.get('StandardOutputContent',''))
        print(invocation.get('StandardErrorContent',''))
        raise SystemExit(0 if status=='Success' else 1)
    time.sleep(5)
raise SystemExit('Deployment wait timed out; inspect Systems Manager before retrying.')
