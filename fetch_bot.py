import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!', look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    'find / -maxdepth 4 -type d -name "*sniper*" 2>/dev/null',
    'find / -maxdepth 5 -type f -name "*.py" 2>/dev/null | head -50',
    'ls -la /root/ /home/ /var/www/ 2>/dev/null',
    'ls -la /opt/ /srv/ /usr/local/ 2>/dev/null',
]

for cmd in commands:
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(f'--- CMD: {cmd} ---')
        print(out)
    if err.strip():
        print(f'--- ERR: {cmd} ---')
        print(err)

ssh.close()
