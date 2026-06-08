import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()
remote_path = '/root/p2c-sniper-bot/logs/sniper.log'

# Получаем размер файла
size = sftp.stat(remote_path).st_size
read_size = min(10000, size)

with sftp.file(remote_path, 'r') as f:
    f.seek(max(0, size - read_size))
    tail = f.read(read_size).decode('utf-8', errors='ignore')

print(tail)

sftp.close()
ssh.close()
