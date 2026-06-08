import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=10)

time.sleep(8)

ssh.exec_command('tail -n 60 /root/p2c-sniper-bot/logs/sniper.log > /tmp/sniper_now.txt')
sftp = ssh.open_sftp()
sftp.get('/tmp/sniper_now.txt', r'C:\Users\Владелец\Desktop\solidusexchange-main\sniper_now.txt')
sftp.close()
ssh.close()
print('OK')