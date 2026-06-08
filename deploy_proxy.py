import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()
sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\sniper.py',
    '/root/p2c-sniper-bot/sniper.py'
)
sftp.close()

ssh.exec_command('systemctl restart sniper-bot.service')
time.sleep(5)

stdin, stdout, stderr = ssh.exec_command('systemctl is-active sniper-bot.service')
print('Service:', stdout.read().decode().strip())

ssh.exec_command('tail -n 5 /root/p2c-sniper-bot/logs/sniper.log > /tmp/tail5.txt')
sftp = ssh.open_sftp()
sftp.get('/tmp/tail5.txt', r'C:\Users\Владелец\Desktop\solidusexchange-main\tail5.txt')
sftp.close()
ssh.close()
print('Done')