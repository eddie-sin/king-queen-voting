# EC2 deployment

This repository deploys one API process and two static websites to the same EC2.
The voter website is `/`, the admin website is `/admin/`, and the API is `/api/v1/`.
Nginx serves the builds and proxies API traffic to port 5000. Do not expose that port
in the EC2 security group. SSH stays restricted to the operator's public IP.

## Server setup

- Ubuntu 24.04 x86_64, Node.js 24.22.1, Nginx, Python 3.12 and Ubuntu's python3-boto3.
- `/etc/king-queen-voting/config.env` is root-owned and readable by the `voting` group
  only. It must contain the intended Atlas URI, JWT settings, region and bucket names.
  Never commit this file, copy it into CI, or include it in an archive.
- EC2 uses the `kqv-ec2` instance role for limited bucket access and Systems Manager.
  No permanent AWS keys are required on the instance.
- Memory Photos use a separate private S3 bucket, configured with
  `AWS_MEMORY_PHOTO_BUCKET` and `MEMORY_PHOTO_STORAGE=s3`.
- Install `king-queen-voting.service` under `/etc/systemd/system/` and `kqv-deploy.py`
  as `/usr/local/sbin/kqv-deploy`, owned by root and not writable by the API user.
- Install the reviewed Nginx configuration and adjust its IP allow list when the
  operator's connection changes. Configure DNS and HTTPS before public use.
- The service runs `node server.js` with `NODE_ENV=production`. This is the same
  application mode as `npm run prod`, without requiring the development-only
  `cross-env` package in a production dependency installation.
- Startup creates required indexes and may seed admin/schedule documents or finalize
  results when due. Verify the database and dates before starting. Never run tests
  against the production database.

## GitHub Actions

The workflow runs on pushes to `main` and supports manual runs on that branch.
It installs locked dependencies, tests against temporary local MongoDB instances,
and builds both frontends on a GitHub-hosted Ubuntu runner. Backend dependencies,
including Sharp's Linux binary, are installed on EC2 as the unprivileged `voting`
user before activating the release.

Repository Actions variables:

| Variable | Meaning |
| --- | --- |
| `KQV_DEPLOY_ENABLED` | Exactly `true` enables deployment after checks pass |
| `KQV_DEPLOY_ROLE_ARN` | Restricted GitHub OIDC role |
| `KQV_DEPLOY_BUCKET` | Private release archive bucket |
| `KQV_INSTANCE_ID` | Voting EC2 instance ID |

GitHub receives temporary AWS credentials through OIDC. The trust policy is limited
to this repository's `main` branch. Deployments use the fixed `KQV-Deploy` SSM
document, version 1, rather than opening SSH to CI runners. Keep write access to
`main` restricted: a push can change the running application.

The archive contains only the API runtime files and built frontend directories;
it excludes credentials, development fixtures, tests, and local dependencies.
SSM passes the commit ID and archive checksum to the root-owned helper. The helper
checks both, installs dependencies in a new release, switches the current symlink,
starts the service and checks `/api/v1/settings` for success. It restores the
previous code release if startup fails. Deployment is serialized in GitHub and by
a server-side lock. A first deployment has no previous release to restore.

## Recovery and maintenance

- `sudo systemctl status king-queen-voting` checks the backend service.
- `sudo journalctl -u king-queen-voting -n 60 --no-pager` reads recent backend logs.
  Do not share logs containing credentials or voting keys.
- `/srv/king-queen-voting/current` points at the active immutable code release.
  The helper retains the active and previous successful releases.
- Code rollback does not undo database writes. Keep database backups separately.
- Release archives expire from the private deployment bucket after seven days.
  System journals are capped at 200 MB and 14 days; Nginx uses Ubuntu log rotation.
- A protected pre-deployment snapshot of test data was saved on the operator's
  laptop, outside this repository. No backup or database credentials are committed.
- Do not run multiple API workers with the current in-process election queue.
- Update Node.js in both the server installation and workflow together.
- At the end of the event, terminate EC2 and check EBS, Elastic IPs, snapshots,
  application/deployment buckets and IAM/OIDC access for cleanup.
