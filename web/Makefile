# Build the rfxgen WASM engine for browser + node.
#
# Requires emscripten (emcc on PATH). Install via:
#   git clone https://github.com/emscripten-core/emsdk ~/emsdk
#   ~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest
#   source ~/emsdk/emsdk_env.sh
#
# Targets:
#   make           - build dist/rfxgen-engine.mjs (+.wasm)
#   make test      - build then run the node test suite
#   make clean     - remove dist/

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

.PHONY: all clean test

all: $(ENGINE_MJS)

$(ENGINE_MJS): wasm_bindings.c ../src/rfxgen.h | $(OUT_DIR)
	$(EMCC) $(CFLAGS) wasm_bindings.c $(LDFLAGS) -o $@

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

test: $(ENGINE_MJS)
	node --test test.mjs notes.test.mjs audio.test.mjs wav.test.mjs

clean:
	rm -rf $(OUT_DIR)
