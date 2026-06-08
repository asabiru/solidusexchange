import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

stdin, stdout, stderr = ssh.exec_command(
    "python3 -c \"data=open('/root/p2c-sniper-bot/logs/sniper.log','rb').read(); print('len:', len(data)); print('last 500:', repr(data[-500:]))\""
)
out = stdout.read().decode()
err = stderr.read().decode()
print('STDOUT:')
print(out)
print('STDERR:')
print(err)

ssh.close()
