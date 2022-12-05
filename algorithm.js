module.exports = {
    rotateEncryptionKey(key) {
        key = Math.imul(key, 1540483477) | 0;
        key = (Math.imul(key >>> 24 ^ key, 1540483477) | 0) ^ 114296087;
        key = Math.imul(key >>> 13 ^ key, 1540483477) | 0;
        return key >>> 15 ^ key;
    },
    rotateBufferBytes(buffer, key) {
        const dataView = new DataView(buffer);
        for(let i = 0; i < dataView.byteLength; i++) dataView.setUint8(i, dataView.getUint8(i) ^ key >>> (i % 4 * 8) & 255);
        return buffer;
    },
    uncompressBuffer(input, output) {
        for(let i = 0, j = 0; i < input.length;) {
            const byte = input[i++];
            let literalsLength = byte >> 4;
            if(literalsLength > 0) {
                let length = literalsLength + 240;
                while(length === 255) {
                    length = input[i++];
                    literalsLength += length;
                };
                const end = i + literalsLength;
                while(i < end) output[j++] = input[i++];
                if(i === input.length) return output;
            };
            const offset = input[i++] | (input[i++] << 8);
            if(offset === 0 || offset > j) return -(i - 2);
            let matchLength = byte & 15;
            let length = matchLength + 240;
            while(length === 255) {
                length = input[i++];
                matchLength += length;
            };
            let pos = j - offset;
            const end = j + matchLength + 4;
            while(j < end) output[j++] = output[pos++];
        };
        return output;
    }
};