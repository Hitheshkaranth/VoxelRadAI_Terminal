from pathlib import Path
import subprocess,os,json
r=Path(__file__).resolve().parent
script=(r/'run-browser.js').read_text().replace('__MANIFEST__',(r/'manifest.json').read_text()).replace('__ROOT__',json.dumps(str(r))).replace('__APP_URL__',json.dumps(os.environ.get('SKANDA_APP_URL','http://localhost:5173')))
p=subprocess.run(['bash',os.environ.get('PLAYWRIGHT_CLI',str(Path.home()/'.codex/skills/playwright/scripts/playwright_cli.sh')),'-s=labeled-validation','run-code',script],capture_output=True,text=True)
(r/'browser-run.log').write_text(p.stdout+'\n'+p.stderr)
print(p.stdout[-4500:]);print(p.stderr[-1000:]);raise SystemExit(p.returncode or (1 if '### Error' in p.stdout else 0))
