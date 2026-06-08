import paramiko

users = ['root', 'ubuntu', 'deploy', 'bot', 'sniper', 'gaz', 'user']
password = '09087691aA!'

for u in users:
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect('82.27.201.169', port=22, username=u, password=password, look_for_keys=False, allow_agent=False, timeout=10, banner_timeout=10, auth_timeout=10)
        print(f"SUCCESS with user: {u}")
        stdin, stdout, stderr = ssh.exec_command('ls -la /')
        print(stdout.read().decode()[:500])
        ssh.close()
        break
    except paramiko.AuthenticationException:
        print(f"Auth failed for: {u}")
    except Exception as e:
        print(f"Error for {u}: {type(e).__name__}: {e}")
