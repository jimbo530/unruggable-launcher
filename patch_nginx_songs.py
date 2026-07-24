import re

with open("/etc/nginx/sites-enabled/tasern", "r") as f:
    content = f.read()

songs_block = """
    # Song videos — unlisted, no directory index, served at /songs/<file>.mp4
    location /songs/ {
        autoindex off;
        add_header Cache-Control "public, max-age=86400";
    }

"""

# Insert before the catch-all "location /" block (the arcade/affiliate comment block)
target = '    # Arcade menu + static games (baseling, ooze-battle)\n    # Money for Trees affiliate program\n    location / {'
replacement = songs_block + '    # Arcade menu + static games (baseling, ooze-battle)\n    # Money for Trees affiliate program\n    location / {'

if target in content:
    content = content.replace(target, replacement)
    with open("/etc/nginx/sites-enabled/tasern", "w") as f:
        f.write(content)
    print("INSERTED OK")
else:
    print("TARGET NOT FOUND — dumping surrounding context:")
    idx = content.find("location / {")
    print(repr(content[max(0,idx-300):idx+50]))
