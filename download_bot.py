import paramiko
import os

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'
remote_path = '/root/p2c-sniper-bot'
local_dir = r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

# Создаём архив на сервере
stdin, stdout, stderr = ssh.exec_command(f'tar -czf /root/p2c-sniper-bot.tar.gz -C /root p2c-sniper-bot && echo "OK" || echo "FAIL"')
result = stdout.read().decode().strip()
print("Archive result:", result)

# Скачиваем архив
sftp = ssh.open_sftp()
remote_archive = '/root/p2c-sniper-bot.tar.gz'
local_archive = os.path.join(local_dir + '.tar.gz')

# Создаём локальную папку
os.makedirs(local_dir, exist_ok=True)

sftp.get(remote_archive, local_archive)
print(f"Downloaded to {local_archive}")

sftp.close()
ssh.close()
