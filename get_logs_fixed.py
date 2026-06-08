import paramiko
import sys
import io

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=10)

cmd = "python3 -c \"print(open('/root/p2c-sniper-bot/logs/sniper.log').read()[-4000:])\""
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)

out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

if out:
    print("=== SNIPER LOG (last 4KB) ===")
    print(out)
if err:
    print("=== STDERR ===")
    print(err)

ssh.close()