import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()
path = '/root/p2c-sniper-bot/logs/sniper.log'
size = sftp.stat(path).st_size
with sftp.file(path, 'r') as f:
    f.seek(max(0, size - 5000))
    data = f.read(5000).decode('utf-8', errors='replace')
print(data)

sftp.close()
ssh.close()