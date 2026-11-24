#!/usr/bin/env python3
"""Enter existing Robokassa live keys directly on the Russian VPS, without echo."""
import getpass
import os
from pathlib import Path
import re
import stat
import tempfile


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root on the product server.')
    path = Path('/etc/konverty.env')
    if path.is_symlink() or not path.is_file():
        raise SystemExit('Expected regular /etc/konverty.env file.')
    print('Enter EXISTING LIVE passwords from the TOP block in Robokassa.')
    print('Nothing will be shown while typing. Test passwords remain unchanged.')
    one = getpass.getpass('Live password #1: ')
    two = getpass.getpass('Live password #2: ')
    if one == two or any(not re.fullmatch(r'[A-Za-z0-9]{16,128}', value) for value in (one, two)):
        raise SystemExit('Passwords must be different, 16-128 Latin letters/digits. No changes made.')
    content = path.read_text()
    for key, value in [('ROBO_LIVE_PASS1', one), ('ROBO_LIVE_PASS2', two)]:
        pattern = r'^' + key + r'=.*$'
        if len(re.findall(pattern, content, re.M)) > 1:
            raise SystemExit('Duplicate configuration entries. No changes made.')
        if re.search(pattern, content, re.M):
            content = re.sub(pattern, lambda _match: key + '=' + value, content, flags=re.M)
        else:
            content = content.rstrip('\n') + '\n' + key + '=' + value + '\n'
    meta = path.stat()
    fd, temp = tempfile.mkstemp(prefix='.konverty-live-', dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(meta.st_mode) & 0o600)
        os.fchown(fd, meta.st_uid, meta.st_gid)
        with os.fdopen(fd, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print('Live keys saved on this server. Payment mode has NOT been changed.')


if __name__ == '__main__':
    main()
