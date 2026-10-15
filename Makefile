UUID = now-playing@methical

.PHONY: schemas test integration pack
schemas:
	glib-compile-schemas schemas/

test:
	gjs -m tests/run.js

integration:
	dbus-run-session -- gjs -m tests/integration.js

pack: schemas
	gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.now-playing.gschema.xml \
	  --extra-source=util.js --extra-source=tracker.js --extra-source=names.js \
	  --extra-source=mpris.js --extra-source=cover.js --extra-source=label.js .
