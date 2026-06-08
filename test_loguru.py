import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

# Write a test script to the server
script = '''
import sys
sys.path.insert(0, '/root/p2c-sniper-bot')
from loguru import logger
import os

logger.remove()
logger.add('/root/p2c-sniper-bot/logs/test_loguru.log', rotation='1 MB')
logger.info('Test loguru write at startup')
print('Printed to stdout')
'''

stdin, stdout, stderr = ssh.exec_command('cat > /tmp/test_loguru.py << "EOF"\n' + script + '\nEOF')
print('Script written:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('cd /root/p2c-sniper-bot && venv/bin/python3 /tmp/test_loguru.py')
out = stdout.read().decode()
err = stderr.read().decode()
print('STDOUT:', out)
print('STDERR:', err)

stdin, stdout, stderr = ssh.exec_command('cat /root/p2c-sniper-bot/logs/test_loguru.log')
print('test_loguru.log:', stdout.read().decode())

ssh.close()
