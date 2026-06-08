import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

commands = [
    "crontab -l 2>/dev/null | grep -i p2c || echo 'No crontab entry'",
    "systemctl list-units --type=service | grep -i p2c || echo 'No systemd service'",
    "ls -la /etc/systemd/system/ | grep -i p2c || echo 'No systemd file'",
    "ps aux | grep '[m]ain.py'",
]

for cmd in commands:
    print(f'\n=== {cmd} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    if out.strip():
        print(out)
    else:
        print('(empty)')

ssh.close()
