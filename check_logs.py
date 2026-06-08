import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

# Получаем последние 200 строк sniper.log
stdin, stdout, stderr = ssh.exec_command('tail -n 200 /root/p2c-sniper-bot/logs/sniper.log', timeout=15)
out = stdout.read().decode()
err = stderr.read().decode()
print(out)
if err.strip():
    print('ERR:', err)

ssh.close()
