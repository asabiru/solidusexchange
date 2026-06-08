import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

stdin, stdout, stderr = ssh.exec_command('ps aux | grep python | grep -v grep')
print(stdout.read().decode())

ssh.close()
