import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=10)

# Save logs to file on server, then download
ssh.exec_command('tail -n 80 /root/p2c-sniper-bot/logs/sniper.log > /tmp/sniper_tail.txt')

sftp = ssh.open_sftp()
local = r'C:\Users\Владелец\Desktop\solidusexchange-main\sniper_tail.txt'
sftp.get('/tmp/sniper_tail.txt', local)
sftp.close()
ssh.close()

print('Logs saved to sniper_tail.txt')