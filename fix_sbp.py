import paramiko

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()
sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\sniper.py',
    '/root/p2c-sniper-bot/sniper.py'
)
sftp.close()

# Kill all and restart via systemd
ssh.exec_command('systemctl stop sniper-bot.service')
import time
time.sleep(2)
ssh.exec_command('ps aux | grep "[m]ain.py" | awk \'{print $2}\' | xargs -r kill -9 2>/dev/null')
time.sleep(1)
ssh.exec_command('systemctl restart sniper-bot.service')
time.sleep(5)

stdin, stdout, stderr = ssh.exec_command('systemctl is-active sniper-bot.service')
print('Service:', stdout.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command("ps aux | grep '[m]ain.py' | grep python | grep -v grep")
print('Process:')
print(stdout.read().decode())

ssh.close()