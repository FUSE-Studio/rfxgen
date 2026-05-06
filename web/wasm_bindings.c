/*******************************************************************************************
*
*   wasm_bindings.c - emscripten wrapper exposing the rfxgen engine to JS.
*
*   The boundary is a flat 96-byte buffer matching the WaveParams struct layout in
*   src/rfxgen.h. JS allocates a buffer with _malloc, writes fields by offset (see
*   bridge.mjs), and passes the pointer in. The C side just dereferences it.
*
*   .rfx serialization happens entirely in JS (those files are 8 header bytes + the
*   96-byte struct) so we don't expose file I/O across the boundary.
*
**********************************************************************************************/

#include <emscripten.h>
#include <stdbool.h>    // rfxgen.h uses bool/true/false (normally supplied by raylib.h)
#include <stdlib.h>

// rfxgen.h uses PI (normally supplied by raylib.h). Match raylib's definition.
#ifndef PI
    #define PI 3.14159265358979323846f
#endif

#define RFXGEN_IMPLEMENTATION
#include "../src/rfxgen.h"

EMSCRIPTEN_KEEPALIVE
unsigned int engine_params_size(void) {
    return (unsigned int)sizeof(WaveParams);
}

EMSCRIPTEN_KEEPALIVE
void engine_seed(unsigned int s) {
    srand(s);
}

EMSCRIPTEN_KEEPALIVE
void engine_reset(WaveParams *out) {
    ResetWaveParams(out);
}

EMSCRIPTEN_KEEPALIVE void engine_preset_coin(WaveParams *out)      { *out = GenPickupCoin(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_laser(WaveParams *out)     { *out = GenLaserShoot(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_explosion(WaveParams *out) { *out = GenExplosion(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_powerup(WaveParams *out)   { *out = GenPowerup(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_hit(WaveParams *out)       { *out = GenHitHurt(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_jump(WaveParams *out)      { *out = GenJump(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_blip(WaveParams *out)      { *out = GenBlipSelect(); }
EMSCRIPTEN_KEEPALIVE void engine_preset_random(WaveParams *out)    { *out = GenRandomize(); }

EMSCRIPTEN_KEEPALIVE
void engine_mutate(WaveParams *params) {
    WaveMutate(params);
}

// Generates a wave from the given params.
// Returns a pointer to a malloc'd float buffer; caller must engine_free it.
// Writes the number of frames into *frameCount.
EMSCRIPTEN_KEEPALIVE
float *engine_generate(WaveParams *params, unsigned int *frameCount) {
    return GenerateWave(*params, frameCount);
}

EMSCRIPTEN_KEEPALIVE
void engine_free(void *ptr) {
    free(ptr);
}
