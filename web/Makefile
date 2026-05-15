# Build the rfxgen WASM engine for browser + node.
#
# Requires emscripten (emcc on PATH). Install via:
#   git clone https://github.com/emscripten-core/emsdk ~/emsdk
#   ~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest
#   source ~/emsdk/emsdk_env.sh
#
# Targets:
#   make           - build dist/rfxgen-engine.mjs
#   make test      - build then run the node test suite
#   make serve     - build then serve at http://localhost:8723
#   make clean     - remove all build artifacts

EMCC ?= emcc

OUT_DIR     := dist
ENGINE_MJS  := $(OUT_DIR)/rfxgen-engine.mjs

# Functions exposed to JS. Underscore prefix is the C-symbol convention emscripten uses.
EXPORTED_FUNCTIONS := \
  '_malloc','_free',\
  '_engine_params_size',\
  '_engine_seed',\
  '_engine_reset',\
  '_engine_preset_coin',\
  '_engine_preset_laser',\
  '_engine_preset_explosion',\
  '_engine_preset_powerup',\
  '_engine_preset_hit',\
  '_engine_preset_jump',\
  '_engine_preset_blip',\
  '_engine_preset_random',\
  '_engine_mutate',\
  '_engine_generate',\
  '_engine_free'

EXPORTED_RUNTIME := 'HEAPU8','HEAPU32','HEAPF32'

CFLAGS := -O2 -I../src

# SINGLE_FILE=1 inlines the .wasm as base64 in the .mjs so there's no separate file
# to fetch — keeps node tests and any deployment trivial. Toggle off later if size matters.
LDFLAGS := \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createRfxgenEngine \
  -s ENVIRONMENT=web,node \
  -s SINGLE_FILE=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16MB \
  -s "EXPORTED_FUNCTIONS=[$(EXPORTED_FUNCTIONS)]" \
  -s "EXPORTED_RUNTIME_METHODS=[$(EXPORTED_RUNTIME)]"

.PHONY: all clean test serve

PORT ?= 8723

all: $(ENGINE_MJS)

$(ENGINE_MJS): wasm_bindings.c ../src/rfxgen.h | $(OUT_DIR)
	$(EMCC) $(CFLAGS) wasm_bindings.c $(LDFLAGS) -o $@

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

test: all
	node --test test.mjs notes.test.mjs audio.test.mjs wav.test.mjs

# Local dev server. Registers .mjs as text/javascript first — Python's
# mimetypes DB doesn't always know about .mjs (varies by Python version)
# and browsers refuse to import ESM modules with octet-stream MIME.
serve: all
	@python3 -c "import mimetypes, http.server, socketserver; \
	mimetypes.add_type('text/javascript', '.mjs'); \
	print('rfxgen serving at http://localhost:$(PORT)/'); \
	socketserver.TCPServer(('', $(PORT)), http.server.SimpleHTTPRequestHandler).serve_forever()"

clean:
	rm -rf $(OUT_DIR) rfxgen.ico
