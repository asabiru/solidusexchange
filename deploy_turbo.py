import paramiko

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
import time
time.sleep(5)

stdin, stdout, stderr = ssh.exec_command('systemctl is-active sniper-bot.service')
print('Service:', stdout.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command("ps aux | grep '[m]ain.py' | grep -v grep")
print('Process:', stdout.read().decode().strip())

ssh.close()