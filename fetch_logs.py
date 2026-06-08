import paramiko, traceback

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
                look_for_keys=False, allow_agent=False, timeout=15)
    
    # Use sftp to read last bytes
    sftp = ssh.open_sftp()
    remote = '/root/p2c-sniper-bot/logs/sniper.log'
    sz = sftp.stat(remote).st_size
    read_start = max(0, sz - 4000)
    
    with sftp.file(remote, 'rb') as f:
        f.seek(read_start)
        raw = f.read(4000)
    
    text = raw.decode('utf-8', errors='replace')
    print(text)
    
    sftp.close()
    ssh.close()
    
except Exception as e:
    traceback.print_exc()