/**
 * OpCode Enum - Sabit tanımlamalar
 * Her OpCode bir byte değeri ve açıklayıcı isim içerir
 */
const OpCode = Object.freeze({
    DEVICE_SETUP: {
        opCode: 0x01,
        name: "Device Setup"
    },
    LOCATION_SETUP: {
        opCode: 0x02,
        name: "Location Setup"
    },
    LIVE_CONTROL: {
        opCode: 0x04,
        name: "Live Control"
    },
    SEND_TASK: {
        opCode: 0x06,
        name: "Send Task"
    },
    RESET_DEVICE: {
        opCode: 0x08,
        name: "Reset Device"
    },
    CLEAR_ALL: {
        opCode: 0x09,
        name: "Clear All"
    },
    RESTART_JOIN: {
        opCode: 0x0A,
        name: "Restart Join"
    },
    DEVICE_INFO: {
        opCode: 0x0B,
        name: "Device Info"
    },
    DEVICE_SETTINGS: {
        opCode: 0x0C,
        name: "Device Settings"
    }
});

/**
 * OpCode değerine göre isim bulma helper fonksiyonu
 * @param {number} opCodeValue - OpCode byte değeri
 * @returns {string|null} - OpCode ismi veya null
 */
function getOpCodeName(opCodeValue) {
    for (const [key, value] of Object.entries(OpCode)) {
        if (value.opCode === opCodeValue) {
            return value.name;
        }
    }
    return null;
}

/**
 * OpCode değerine göre key bulma helper fonksiyonu
 * @param {number} opCodeValue - OpCode byte değeri
 * @returns {string|null} - OpCode key'i veya null
 */
function getOpCodeKey(opCodeValue) {
    for (const [key, value] of Object.entries(OpCode)) {
        if (value.opCode === opCodeValue) {
            return key;
        }
    }
    return null;
}

/**
 * Type sabitleri - Request ve Response için
 */
const MessageType = Object.freeze({
    REQUEST: 0, // get
    RESPONSE: 1 //set
});

/**
 * Channel List - Tüm kanal tanımlamaları
 * Her kanal: channelId, name, protocol, byteLength, dataType, forced
 */
const ChannelList = Object.freeze([
    {
        channelId: 1,
        name: "Dim Value",
        protocol: "Dali2/D4i",
        byteLength: 1,
        dataType: "byte",
        forced: true,
        detail: null
    },
    {
        channelId: 2,
        name: "Device Type",
        protocol: "Dali2/D4i",
        byteLength: 1,
        dataType: "byte",
        forced: true,
        detail: "Dali2: 1, D4i: 2, Unknown: 0"
    },
    {
        channelId: 3,
        name: "Status",
        protocol: "Dali2/D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: "Bit0: Control Gear Failure, Bit1: Lamp Failure, Bit2: Lamp On, Bit3: Limit Error, Bit4: Fade Running, Bit5: Reset State, Bit6: Missing Short Address, Bit7: Power Cycle Seen"
    },
    {
        channelId: 4,
        name: "Fault Summary",
        protocol: "D4i",
        byteLength: 2,
        dataType: "ushort",
        forced: false,
        detail: "Bit0: Overall Failure Flag, Bit1: Under Voltage Flag, Bit2: Over Voltage Flag, Bit3: Power Limit Flag, Bit4: Thermal Derating Flag, Bit5: Thermal Shutdown Flag, Bit6: Overall Failure Flag Light Src, Bit7: Short Circuit Light Src, Bit8: Thermal Derating Light Src Flag, Bit9: Thermal Shutdown Light Src Flag"
    },
    {
        channelId: 5,
        name: "Supply Voltage",
        protocol: "D4i",
        byteLength: 2,
        dataType: "ushort",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual voltage: VALUE * 0.1"
    },
    {
        channelId: 6,
        name: "Power Factor",
        protocol: "D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: "RAW VALUE. For actual power factor: VALUE * 0.01"
    },
    {
        channelId: 7,
        name: "Internal Temp",
        protocol: "D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: null
    },
    {
        channelId: 8,
        name: "Output Current Percent",
        protocol: "D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: null
    },
    {
        channelId: 9,
        name: "Light SRC voltage",
        protocol: "D4i",
        byteLength: 2,
        dataType: "ushort",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual voltage: VALUE * 0.1"
    },
    {
        channelId: 10,
        name: "Light SRC current",
        protocol: "D4i",
        byteLength: 2,
        dataType: "ushort",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual current: VALUE * 0.001"
    },
    {
        channelId: 11,
        name: "Light SRC temp",
        protocol: "D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: null
    },
    {
        channelId: 12,
        name: "ACT PWR SCALE FACTOR",
        protocol: "D4i",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: "RAW VALUE. Use this value as exponent to interpret 'Instant Power' (e.g., if -2 comes, multiply Instant Power value by 10^-2)"
    },
    {
        channelId: 13,
        name: "Operating Time",
        protocol: "D4i",
        byteLength: 4,
        dataType: "int",
        forced: false,
        detail: null
    },
    {
        channelId: 14,
        name: "Start Counter",
        protocol: "D4i",
        byteLength: 4,
        dataType: "int",
        forced: false,
        detail: null
    },
    {
        channelId: 15,
        name: "Short Address",
        protocol: "Dali2/D4i",
        byteLength: 1,
        dataType: "byte",
        forced: true,
        detail: "Indicates which DALI sub-device this is"
    },
    {
        channelId: 16,
        name: "Tilt",
        protocol: "External",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: null
    }, {
        channelId: 17,
        name: "Ldr",
        protocol: "External",
        byteLength: 2,
        dataType: "ushort",
        forced: false,
        detail: null
    }, {
        channelId: 18,
        name: "External Voltage",
        protocol: "External",
        byteLength: 2,
        dataType: "short",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual voltage: VALUE / 10.0"
    }, {
        channelId: 19,
        name: "External Current",
        protocol: "External",
        byteLength: 2,
        dataType: "short",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual current in Amperes: VALUE / 1000.0"
    }, {
        channelId: 20,
        name: "External Active Power",
        protocol: "External",
        byteLength: 4,
        dataType: "int",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual active power in Watts: VALUE / 100.0"
    }, {
        channelId: 21,
        name: "External ReActive Power",
        protocol: "External",
        byteLength: 4,
        dataType: "int",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual reactive power in VAR: VALUE / 100.0"
    }, {
        channelId: 22,
        name: "External Active Energy",
        protocol: "External",
        byteLength: 4,
        dataType: "int",
        forced: false,
        detail: "RAW VALUE (Little-Endian). For actual active energy in Wh: VALUE / 10.0"
    }, {
        channelId: 23,
        name: "External Power Factor",
        protocol: "External",
        byteLength: 1,
        dataType: "byte",
        forced: false,
        detail: "RAW VALUE. For actual power factor: VALUE / 100.0"
    }

]);



/**
 * Header data oluşturma fonksiyonu
 * @param {Object} opCodeEnum - OpCode enum objesi (örn: OpCode.DEVICE_SETUP)
 * @param {number} type - Message type (0 = REQUEST, 1 = RESPONSE)
 * @param {number} dataLength - Data uzunluğu (0-255)
 * @returns {Uint8Array} - Header byte dizisi [headerByte, dataLength]
 */
function createHeaderData(opCodeEnum, type, dataLength) {
    // OpCode'u al ve 7 bit'e sınırla
    let opCode = opCodeEnum.opCode & 0b01111111;

    // Type'ı 1 bit'e sınırla
    type = type & 0b1;

    // Header byte oluştur: [TYPE (1 bit)][OPCODE (7 bit)]
    const headerByte = (type << 7) | opCode;

    // DataLength'i byte'a sınırla
    const dataLengthByte = dataLength & 0xFF;

    // Byte dizisi oluştur
    const buffer = new Uint8Array(2);
    buffer[0] = headerByte;
    buffer[1] = dataLengthByte;

    return buffer;
}

/**
 * Device Reset komutu oluşturur ve Base64 string olarak döndürür
 * Software Reset atar. 
 * @returns {string} - Base64 encoded device reset command
 */
function createDeviceResetData() {
    const header = createHeaderData(OpCode.RESET_DEVICE, MessageType.RESPONSE, 0);
    const base64String = btoa(String.fromCharCode(...header));
    return base64String;
}

/**
 * Device Setup komutu oluşturur ve Base64 string olarak döndürür
 * Cihazın hangi kanalları raporlayacağını ayarlar
 * @param {Array<number>} channelIds - Kanal ID listesi (1-20 arası)
 * @returns {string} - Base64 encoded device setup command
 * Toplam kanalların byte lenght > 30 olamaz.
 */
function createDeviceSetupData(channelIds) {
    // Validate and filter channel IDs
    const validChannelIds = channelIds
        .filter(id => id >= 1 && id <= 20)
        .map(id => parseInt(id));

    // Sort channel IDs from smallest to largest
    validChannelIds.sort((a, b) => a - b);

    // Remove duplicates
    const uniqueChannelIds = [...new Set(validChannelIds)];

    // Calculate total byte length of selected channels
    let totalByteLength = 0;
    for (const channelId of uniqueChannelIds) {
        const channel = ChannelList.find(ch => ch.channelId === channelId);
        if (channel) {
            totalByteLength += channel.byteLength;
        }
    }

    // Validate: total byte length must not exceed 30
    if (totalByteLength > 30) {
        throw new Error(`Total byte length of selected channels (${totalByteLength}) exceeds maximum allowed (30 bytes)`);
    }

    // Data length = number of channel IDs
    const dataLength = uniqueChannelIds.length;

    // Create header
    const header = createHeaderData(OpCode.DEVICE_SETUP, MessageType.RESPONSE, dataLength);

    // Create buffer: header (2 bytes) + channel IDs (dataLength bytes)
    const buffer = new Uint8Array(2 + dataLength);
    buffer[0] = header[0];  // headerByte
    buffer[1] = header[1];  // dataLength

    // Add channel IDs (1 byte each)
    for (let i = 0; i < uniqueChannelIds.length; i++) {
        buffer[2 + i] = uniqueChannelIds[i] & 0xFF;
    }

    // Convert to Base64
    const base64String = btoa(String.fromCharCode(...buffer));

    return base64String;
}

/**
 * Device Clear komutu oluşturur ve Base64 string olarak döndürür
 * Tüm verileri tasklar,locationu temizler. Default verilere döner.
 * @returns {string} - Base64 encoded device reset command
 */
function createDeviceClearData() {
    const header = createHeaderData(OpCode.CLEAR_ALL, MessageType.RESPONSE, 0);
    const base64String = btoa(String.fromCharCode(...header));
    return base64String;
}

/**
 * Device Restart Join komutu oluşturur ve Base64 string olarak döndürür
 * Cihazın ağa yeniden katılması için istek gönderir.
 * @returns {string} - Base64 encoded device reset command
 */
function createDeviceRestartJoinData() {
    const header = createHeaderData(OpCode.RESTART_JOIN, MessageType.RESPONSE, 0);
    const base64String = btoa(String.fromCharCode(...header));
    return base64String;
}

/**
 * Device Info Request komutu oluşturur ve Base64 string olarak döndürür
 * Cihazdan bilgi almak için istek gönderir.
 * @param {number} infoId - Info ID değeri (1 byte, default: 1)
 * @returns {string} - Base64 encoded device info request command
 */
function createDeviceInfoRequestData(infoId = 1) {
    const header = createHeaderData(OpCode.DEVICE_INFO, MessageType.REQUEST, 1);
    const buffer = new Uint8Array(3);
    buffer[0] = header[0];
    buffer[1] = header[1];
    buffer[2] = infoId & 0xFF;
    const base64String = btoa(String.fromCharCode(...buffer));
    return base64String;
}

/**
 * Device Settings komutu oluşturur ve Base64 string olarak döndürür
 * Cihaz ayarlarını yapılandırır
 * @param {number} groupId - Group ID değeri (1 byte)
 * @param {number} uplinkTime - Uplink zamanı (1 byte, sadece groupId === 4 için)
 * @param {boolean} isConfirmed - Confirmed mesaj mı (1 byte bool, sadece groupId === 4 için)
 * @param {boolean} forceRejoinRestart - Force rejoin restart (1 byte bool, sadece groupId === 4 için)
 * @param {number} year - Yıl (1 byte, 2000'den itibaren offset, sadece groupId === 5 için)
 * @param {number} month - Ay (1 byte, 1-12, sadece groupId === 5 için)
 * @param {number} day - Gün (1 byte, 1-31, sadece groupId === 5 için)
 * @param {number} hour - Saat (1 byte, 0-23, sadece groupId === 5 için)
 * @param {number} minute - Dakika (1 byte, 0-59, sadece groupId === 5 için)
 * @param {number} second - Saniye (1 byte, 0-59, sadece groupId === 5 için)
 * @param {number} dayOfWeek - Haftanın günü (1 byte, 0=Pazar, 1=Pazartesi, ..., 6=Cumartesi, sadece groupId === 5 için)
 * @returns {string} - Base64 encoded device settings command
 */
function createDeviceSettingsSetData(groupId, uplinkTime = 0, isConfirmed = false, forceRejoinRestart = false,
    year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0, dayOfWeek = 0) {
    let dataLength;

    if (groupId === 4) {
        dataLength = 4;
    } else if (groupId === 5) {
        dataLength = 8;
    } else {
        dataLength = 1;
    }

    const header = createHeaderData(OpCode.DEVICE_SETTINGS, MessageType.RESPONSE, dataLength);
    const buffer = new Uint8Array(2 + dataLength);

    buffer[0] = header[0];
    buffer[1] = header[1];
    buffer[2] = groupId & 0xFF;

    if (groupId === 4) {
        buffer[3] = uplinkTime & 0xFF;
        buffer[4] = isConfirmed ? 1 : 0;
        buffer[5] = forceRejoinRestart ? 1 : 0;
    } else if (groupId === 5) {
        buffer[3] = year & 0xFF;
        buffer[4] = month & 0xFF;
        buffer[5] = day & 0xFF;
        buffer[6] = hour & 0xFF;
        buffer[7] = minute & 0xFF;
        buffer[8] = second & 0xFF;
        buffer[9] = dayOfWeek & 0xFF;
    }

    const base64String = btoa(String.fromCharCode(...buffer));
    return base64String;
}

/**
 * Device Settings Request komutu oluşturur ve Base64 string olarak döndürür
 * Cihazdan belirli bir grup ayarını sorgulamak için kullanılır
 * @param {number} groupId - Group ID değeri (1 byte)
 * @returns {string} - Base64 encoded device settings request command
 */
function createDeviceSettingsRequestData(groupId) {
    const header = createHeaderData(OpCode.DEVICE_SETTINGS, MessageType.REQUEST, 1);
    const buffer = new Uint8Array(3);

    buffer[0] = header[0];
    buffer[1] = header[1];
    buffer[2] = groupId & 0xFF;

    const base64String = btoa(String.fromCharCode(...buffer));
    return base64String;
}


/**
 * Live Control komutu oluşturur ve Base64 string olarak döndürür
 * Cihazın dim seviyesini kontrol eder (0-100 arası)
 * @param {number} dimValue - Dim değeri (0-100 arası, 0 = kapalı, 100 = tam açık)
 * @returns {string} - Base64 encoded live control command
 */
function createLiveControlData(dimValue) {
    const header = createHeaderData(OpCode.LIVE_CONTROL, MessageType.RESPONSE, 1);
    const buffer = new Uint8Array(3);
    buffer[0] = header[0];
    buffer[1] = header[1];
    buffer[2] = dimValue & 0xFF;
    const base64String = btoa(String.fromCharCode(...buffer));
    return base64String;
}

/**
 * Location Setup komutu oluşturur ve Base64 string olarak döndürür
 * Cihazın konum bilgilerini ayarlar
 * @param {number} latitude - Enlem (float, 4 byte)
 * @param {number} longitude - Boylam (float, 4 byte)
 * @param {number} timezone - Saat dilimi (float, 4 byte)
 * @returns {string} - Base64 encoded location setup command
 */
function createLocationData(latitude, longitude, timezone) {
    // Header oluştur (OpCode: LOCATION_SETUP, Type: RESPONSE, DataLength: 12)
    const header = createHeaderData(OpCode.LOCATION_SETUP, MessageType.RESPONSE, 12);

    // Buffer oluştur: header (2 byte) + data (12 byte) = 14 byte
    const buffer = new Uint8Array(14);
    buffer[0] = header[0];  // headerByte
    buffer[1] = header[1];  // dataLength

    // DataView kullanarak float değerleri little-endian olarak yaz
    const dataView = new DataView(buffer.buffer);

    // Latitude (4 byte float, little-endian)
    dataView.setFloat32(2, latitude, true);

    // Longitude (4 byte float, little-endian)
    dataView.setFloat32(6, longitude, true);

    // Timezone (4 byte float, little-endian)
    dataView.setFloat32(10, timezone, true);

    // Base64'e çevir
    const base64String = btoa(String.fromCharCode(...buffer));

    return base64String;
}

/**
 * Task Data yapısı - Task konfigürasyonu için veri modeli
 */
class TaskData {
    constructor() {
        // Task temel bilgileri
        this.operationType;      // 1 byte (1 = deploy, 2 = update, 3 = delete)
        this.taskProfileId;      // 4 byte int
        this.startYear;          // 1 byte (2000'den itibaren offset)
        this.startMonth;         // 1 byte (1-12)
        this.startDay;           // 1 byte (1-31)
        this.endYear;            // 1 byte (2000'den itibaren offset, forever ise 99)
        this.endMonth;          // 1 byte (1-12, forever ise 99)
        this.endDay;            // 1 byte (1-31, forever ise 99)
        this.priority;           // 1 byte
        this.cyclicType;         // 1 byte (odd=2, even=3, cyclic=4, custom=5)
        this.cyclicTime;         // 1 byte (eğer cyclic ise kaç günde bir çalışacak değilse sabit 0)
        this.offDaysMask;        // 1 byte (bit mask for off days, pazar 1den başlıyor. eğer hep açıksa 0)
        this.channelNumber;      // 1 byte
        this.timeSlots = [ //sunrise için hour ve minute 61, sunset için hour ve minute 62, offset ise -60 +60 arası
            //her zaman 4 zaman dilimide gitmeli. olmayanları sabit 0lar ile doldurmalısınız.
            {
                onTimeHour: 0,       // 1 byte (0-23)
                onTimeMinute: 0,     // 1 byte (0-59)
                onTimeOffset: 0,     // 1 byte (sunrise/sunset offset)
                offTimeHour: 0,      // 1 byte (0-23)
                offTimeMinute: 0,    // 1 byte (0-59)
                offTimeOffset: 0,    // 1 byte (sunrise/sunset offset)
                value: 0             // 1 byte (dim value 0-100)
            },
            {
                onTimeHour: 0,
                onTimeMinute: 0,
                onTimeOffset: 0,
                offTimeHour: 0,
                offTimeMinute: 0,
                offTimeOffset: 0,
                value: 0
            },
            {
                onTimeHour: 0,
                onTimeMinute: 0,
                onTimeOffset: 0,
                offTimeHour: 0,
                offTimeMinute: 0,
                offTimeOffset: 0,
                value: 0
            },
            {
                onTimeHour: 0,
                onTimeMinute: 0,
                onTimeOffset: 0,
                offTimeHour: 0,
                offTimeMinute: 0,
                offTimeOffset: 0,
                value: 0
            }
        ];
    }
}

/**
 * Task Data'yı byte array'e çevirip Base64 string olarak döndürür
 * @param {TaskData} taskData - Task konfigürasyon objesi
 * @returns {string} - Base64 encoded task data
 */
function prepareTaskData(taskData) {
    // Header oluştur (OpCode: SEND_TASK, Type: RESPONSE, DataLength: 44)
    const header = createHeaderData(OpCode.SEND_TASK, MessageType.RESPONSE, 44);

    // Buffer oluştur: header (2 byte) + data (44 byte) = 46 byte
    const buffer = new Uint8Array(46);
    let index = 0;

    // Header
    buffer[index++] = header[0];  // headerByte
    buffer[index++] = header[1];  // dataLength

    // Operation Type (1 byte)
    buffer[index++] = taskData.operationType & 0xFF;

    // Task Profile ID (4 byte, little-endian)
    const dataView = new DataView(buffer.buffer);
    dataView.setUint32(index, taskData.taskProfileId, true);
    index += 4;

    // Start Date (3 bytes)
    buffer[index++] = taskData.startYear & 0xFF;
    buffer[index++] = taskData.startMonth & 0xFF;
    buffer[index++] = taskData.startDay & 0xFF;

    // End Date (3 bytes)
    buffer[index++] = taskData.endYear & 0xFF;
    buffer[index++] = taskData.endMonth & 0xFF;
    buffer[index++] = taskData.endDay & 0xFF;

    // Task Properties (5 bytes)
    buffer[index++] = taskData.priority & 0xFF;
    buffer[index++] = taskData.cyclicType & 0xFF;
    buffer[index++] = taskData.cyclicTime & 0xFF;
    buffer[index++] = taskData.offDaysMask & 0xFF;
    buffer[index++] = taskData.channelNumber & 0xFF;

    // Time Slots (4 × 7 bytes = 28 bytes)
    for (let i = 0; i < 4; i++) {
        const slot = taskData.timeSlots[i];
        buffer[index++] = slot.onTimeHour & 0xFF;
        buffer[index++] = slot.onTimeMinute & 0xFF;
        buffer[index++] = slot.onTimeOffset & 0xFF;
        buffer[index++] = slot.offTimeHour & 0xFF;
        buffer[index++] = slot.offTimeMinute & 0xFF;
        buffer[index++] = slot.offTimeOffset & 0xFF;
        buffer[index++] = slot.value & 0xFF;
    }

    // Base64'e çevir
    const base64String = btoa(String.fromCharCode(...buffer));

    return base64String;
}

/**
 * Task Request komutu oluşturur ve Base64 string olarak döndürür
 * Cihazdan belirli bir task bilgisini sorgulamak için kullanılır
 * @param {number} index - Task index değeri (1 byte)
 * @returns {string} - Base64 encoded task request command
 */
function createTaskRequestData(index) {
    const header = createHeaderData(OpCode.SEND_TASK, MessageType.REQUEST, 1);
    const buffer = new Uint8Array(3);

    buffer[0] = header[0];
    buffer[1] = header[1];
    buffer[2] = index & 0xFF;

    const base64String = btoa(String.fromCharCode(...buffer));
    return base64String;
}
