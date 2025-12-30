// Dither Worker - Floyd-Steinberg dithering in a Web Worker
// Offloads expensive dithering computation from the main thread

self.onmessage = function(e) {
    var data = e.data;
    var imageData = new Uint8ClampedArray(data.imageData);
    var width = data.width;
    var height = data.height;
    var bits = data.bits;
    var strength = data.strength;
    var id = data.id;

    // Perform Floyd-Steinberg dithering
    var result = applyDithering(imageData, width, height, bits, strength);

    // Send back the result
    self.postMessage({
        imageData: result.buffer,
        id: id
    }, [result.buffer]);
};

function applyDithering(data, width, height, bits, strength) {
    // Create grayscale buffer
    var gray = new Float32Array(width * height);

    // Convert to grayscale
    for (var i = 0; i < width * height; i++) {
        var idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

    // Floyd-Steinberg dithering
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var idx = y * width + x;
            var oldPixel = gray[idx];
            var newPixel = quantize(oldPixel, bits);
            gray[idx] = newPixel;

            var error = (oldPixel - newPixel) * strength;

            // Distribute error to neighboring pixels
            if (x + 1 < width) {
                gray[idx + 1] += error * 7 / 16;
            }
            if (y + 1 < height) {
                if (x > 0) {
                    gray[idx + width - 1] += error * 3 / 16;
                }
                gray[idx + width] += error * 5 / 16;
                if (x + 1 < width) {
                    gray[idx + width + 1] += error * 1 / 16;
                }
            }
        }
    }

    // Write back to RGBA buffer
    for (var i = 0; i < width * height; i++) {
        var v = Math.max(0, Math.min(255, Math.round(gray[i])));
        var idx = i * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        // Keep alpha unchanged
    }

    return data;
}

function quantize(value, bits) {
    if (bits === 1) {
        // 1-bit: black or white
        return value < 128 ? 0 : 255;
    } else {
        // 2-bit: 4 levels for XTH format
        // Uses Xteink-specific thresholds
        if (value > 212) return 255;      // White
        if (value > 127) return 170;      // Light Gray
        if (value > 42) return 85;        // Dark Gray
        return 0;                         // Black
    }
}
