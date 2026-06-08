import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

# Сохраняем последние 200 строк логов во временный файл на сервере
stdin, stdout, stderr = ssh.exec_command('tail -n 200 /root/p2c-sniper-bot/logs/sniper.log > /tmp/sniper_tail.log 2>&1; cat /tmp/sniper_tail.log')
out = stdout.read().decode()
err = stderr.read().decode()

print('=== OUTPUT ===')
print(out if out else '(empty)')
if err.strip():
    print('=== STDERR ===')
    print(err)

# Также проверим есть ли вообще файл
stdin, stdout, stderr = ssh.exec_command('ls -la /root/p2c-sniper-bot/logs/')
print('=== logs dir ===')
print(stdout.read().decode())

ssh.close()
