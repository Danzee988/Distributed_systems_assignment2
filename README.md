s3 cp .\images\sunflower.jpeg s3://<bucket name>/<name of the image>

aws s3api delete-object --bucket <bucket name> --key <name of the image>
