deploy:
	make login
	yarn deploy

login:
	[ -f ~/.clasprc.json ] || yarn clasp login
