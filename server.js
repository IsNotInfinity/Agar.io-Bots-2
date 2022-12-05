const WebSocket = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");
const Reader = require("./reader.js");
const Entity = require("./entity.js");
const fs = require("fs");
const { murmur2 } = require("murmurhash-js");
const algorithm = require("./algorithm.js");
const buffers = require("./buffers.js");

const proxyList = fs.readFileSync("./proxies.txt", "utf-8").trim().split("\n");

let game = {
    ip: '',
    url: '',
    protocolVersion: 0,
    clientVersion: 0,
    mouseX: 0,
    mouseY: 0,
    followMouse: false,
    bots: []
};

class Bot {
    constructor(id) {
        this.id = id;
        this.name = `USA`;
        this.list = proxyList[this.id].split(":");
        this.proxy = `http://${this.list[0]}:${this.list[1]}`;
        this.agent = new HttpsProxyAgent(this.proxy);
        this.ws = null;
        this.headers = {
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "es-419,es;q=0.9",
            "Cache-Control": "no-cache",
            "Connection": "Upgrade",
            "Host": game.url,
            "Origin": "https://agar.io",
            "Pragma": "no-cache",
            "Upgrade": "websocket", 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
        };
        this.protocolVersion = game.protocolVersion;
        this.clientVersion = game.clientVersion;
        this.encryptionKey = 0;
        this.serverVersion = "";
        this.decryptionKey = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.viewportEntities = {};
        this.cellsIDs = [];
        this.connect();
    };

    connect() {
        this.ws = new WebSocket(game.ip, {
            headers: this.headers,
            agent: this.agent,
            rejectUnauthorized: false
        });
        this.ws.binaryType = "arraybuffer";
        this.ws.onopen = this.onopen.bind(this);
        this.ws.onmessage = this.onmessage.bind(this);
        this.ws.onerror = this.onerror.bind(this);
    };

    send(buffer) {
        if(this.ws.readyState === WebSocket.OPEN) {
            if(this.encryptionKey) {
                buffer = algorithm.rotateBufferBytes(buffer.buffer, this.encryptionKey);
                this.encryptionKey = algorithm.rotateEncryptionKey(this.encryptionKey);
            };
            this.ws.send(buffer);
        };
    };

    onopen() {
        this.send(buffers.protocol(this.protocolVersion));
        this.send(buffers.client(this.clientVersion));
    };

    onmessage(data) {
        if(this.decryptionKey) {
            this.handleBuffer(algorithm.rotateBufferBytes(data.data, this.decryptionKey ^ this.clientVersion));
        } else {
            this.handleBuffer(data.data);
        };
    };

    onerror(error) {
    };

    handleBuffer(buffer) {
        const reader = new Reader(buffer, true);
        switch(reader.readUint8()) {
            case 32: {
                this.cellsIDs.push(reader.readUint32());
                setInterval(() => {
                    this.move();
                }, 40);
                break;
            };
            case 241: {
                this.decryptionKey = reader.readUint32();
                this.serverVersion = reader.readString();
                this.encryptionKey = murmur2(`${game.url}${this.serverVersion}`, 255);
                break;
            };
            case 242: {
                setInterval(() => {
                    this.send(buffers.spawn(this.name));
                }, 2000);
                break;
            };
            case 255: {
                this.handleCompressedBuffer(algorithm.uncompressBuffer(new Uint8Array(reader.dataView.buffer.slice(5)), new Uint8Array(reader.readUint32())));
                break;
            };
        };
    };

    handleCompressedBuffer(buffer) {
        const reader = new Reader(buffer.buffer, true);
        switch(reader.readUint8()) {
            case 16: {
                this.updateViewportEntities(reader);
                break;
            };
            case 64: {
                this.updateOffset(reader);
                break;
            };
        };
    };

    updateViewportEntities(reader) {
        const eatRecordLength = reader.readUint16();
        for(let i = 0; i < eatRecordLength; i++) {
            reader.byteOffset += 8;
        };
        while(true) {
            const id = reader.readUint32();
            if(id === 0) {
                break;
            };
            const entity = new Entity();
            entity.id = id;
            entity.x = reader.readInt32();
            entity.y = reader.readInt32();
            entity.size = reader.readUint16();
            const flags = reader.readUint8();
            const extendedFlags = flags & 128 ? reader.readUint8() : 0;
            if(flags & 1) entity.isVirus = true;
            if(flags & 2) reader.byteOffset += 3;
            if(flags & 4) entity.skin = reader.readString();
            if(flags & 8) entity.name = reader.readString();
            if(extendedFlags & 1) entity.isPellet = true;
            if(extendedFlags & 4) reader.byteOffset += 4;
            this.viewportEntities[entity.id] = entity;
        };

        const removeRecordLength = reader.readUint16();
        for (let i = 0; i < removeRecordLength; i++) {
            const removedEntityID = reader.readUint32();
            if (this.cellsIDs.includes(removedEntityID)) this.cellsIDs.splice(this.cellsIDs.indexOf(removedEntityID), 1);
            delete this.viewportEntities[removedEntityID];
        };
    };

    updateOffset(reader) {
        const left = reader.readFloat64();
        const top = reader.readFloat64();
        const right = reader.readFloat64();
        const bottom = reader.readFloat64();
        if (~~(right - left) === 14142 && ~~(bottom - top) === 14142) {
            this.offsetX = (left + right) / 2;
            this.offsetY = (top + bottom) / 2;
        };
    };

    getClosestEntity(type, botX, botY, botSize) {
        let closestDistance = Infinity;
        let closestEntity = null;
        for (const entity of Object.values(this.viewportEntities)) {
            let isConditionMet = false;
            switch (type) {
                case 'biggerPlayer': {
                    isConditionMet = !entity.isVirus && !entity.isPellet && entity.size > botSize * 1.15 && entity.name !== this.name;
                    break;
                };
                case 'smallerPlayer': {
                    isConditionMet = !entity.isVirus && !entity.isPellet && entity.size < botSize && entity.name !== this.name;
                    break;
                };
                case 'pellet': {
                    isConditionMet = !entity.isVirus && entity.isPellet;
                    break;
                };
            };
            if (isConditionMet) {
                const distance = this.calculateDistance(botX, botY, entity.x, entity.y);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestEntity = entity;
                };
            };
        };
        return {
            distance: closestDistance,
            entity: closestEntity
        };
    };

    calculateDistance(botX, botY, targetX, targetY) {
        return Math.hypot(targetX - botX, targetY - botY);
    };

    move() {
        const bot = {
            x: 0,
            y: 0,
            size: 0,
        };

        for (const id of this.cellsIDs) {
            const cell = this.viewportEntities[id];
            if (cell) {
                bot.x += cell.x / this.cellsIDs.length;
                bot.y += cell.y / this.cellsIDs.length;
                bot.size += cell.size;
            };

        };

        const closestBiggerPlayer = this.getClosestEntity('biggerPlayer', bot.x, bot.y, bot.size);
        const closestSmallerPlayer = this.getClosestEntity('smallerPlayer', bot.x, bot.y, bot.size);
        const closestPellet = this.getClosestEntity('pellet', bot.x, bot.y, bot.size);

        if(game.followMouse === true) {
            this.send(buffers.move(game.mouseX + this.offsetX, game.mouseY + this.offsetY, this.decryptionKey));
        } else if (closestBiggerPlayer.entity && closestBiggerPlayer.distance < Math.sqrt(closestBiggerPlayer.entity.size * 100 / Math.PI) + 420) {
            const angle = (Math.atan2(closestBiggerPlayer.entity.y - bot.y, closestBiggerPlayer.entity.x - bot.x) + Math.PI) % (2 * Math.PI);
            this.send(buffers.move(14142 * Math.cos(angle), 14142 * Math.sin(angle), this.decryptionKey));
        } else if (closestPellet.entity) {
            this.send(buffers.move(closestPellet.entity.x, closestPellet.entity.y, this.decryptionKey));
        } else if (!closestBiggerPlayer.entity && !closestPellet.entity) {
            const random = Math.random();
            const randomX = ~~(1337 * Math.random());
            const randomY = ~~(1337 * Math.random());
            if (random > 0.5) this.send(buffers.move(bot.x + randomX, bot.y - randomY, this.decryptionKey));
            else if (random < 0.5) this.send(buffers.move(bot.x - randomX, bot.y + randomY, this.decryptionKey));
        };

    };

};

const server = new WebSocket.Server({
    port: 6969
});

server.on("connection", ws => {
    let id = 0;
    ws.on("message", buffer => {
        buffer = new Uint8Array(buffer);
        const reader = new Reader(buffer.buffer, true);
        switch(reader.readUint8()) {
            case 0: {
                game.ip = reader.readString();
                game.url = game.ip.replace(/wss:\/\//, "");
                game.url = game.url.replace(/:443/, "");
                game.url = game.url.replace(/[?]party_id=(\w+)/, "");
                game.protocolVersion = reader.readUint32();
                game.clientVersion = reader.readUint32();
                setInterval(() => {
                    if(id < proxyList.length) {
                        game.bots.push(new Bot(id));
                        id++;
                    };
                }, 40);
                console.log("Bots Starting...");
                break;
            };
            case 1: {
                for(const i in game.bots) game.bots[i].send(new Uint8Array([17]));
                break;
            };
            case 2: {
                for(const i in game.bots) game.bots[i].send(new Uint8Array([21]));
                break;
            };
            case 3: {
                game.followMouse = true;
                break;
            };
            case 4: {
                game.followMouse = false;
                break;
            };
            case 10: {
                game.mouseX = reader.readInt32();
                game.mouseY = reader.readInt32();
                break;
            };
        };
    });
});

setInterval(() => {
    console.log(game.bots.length);
}, 5000);