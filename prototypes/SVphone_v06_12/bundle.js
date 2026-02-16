(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@bsv/sdk/dist/esm/src/primitives/BigNumber.js
  var BufferCtor = typeof globalThis !== "undefined" ? globalThis.Buffer : void 0;
  var CAN_USE_BUFFER = BufferCtor != null && typeof BufferCtor.from === "function";
  var HEX_CHAR_TO_VALUE = new Int8Array(256).fill(-1);
  for (let i = 0; i < 10; i++) {
    HEX_CHAR_TO_VALUE[48 + i] = i;
  }
  for (let i = 0; i < 6; i++) {
    HEX_CHAR_TO_VALUE[65 + i] = 10 + i;
    HEX_CHAR_TO_VALUE[97 + i] = 10 + i;
  }
  var _BigNumber = class _BigNumber {
    /**
     * @constructor
     *
     * @param number - The number (various types accepted) to construct a BigNumber from. Default is 0.
     * @param base - The base of number provided. By default is 10.
     * @param endian - The endianness provided. By default is 'big endian'.
     */
    constructor(number = 0, base = 10, endian = "be") {
      __publicField(this, "_magnitude");
      __publicField(this, "_sign");
      __publicField(this, "_nominalWordLength");
      /**
       * Reduction context of the big number.
       *
       * @property red
       */
      __publicField(this, "red");
      this._magnitude = 0n;
      this._sign = 0;
      this._nominalWordLength = 1;
      this.red = null;
      if (number === void 0)
        number = 0;
      if (number === null) {
        this._initializeState(0n, 0);
        return;
      }
      if (typeof number === "bigint") {
        this._initializeState(number < 0n ? -number : number, number < 0n ? 1 : 0);
        this.normSign();
        return;
      }
      let effectiveBase = base;
      let effectiveEndian = endian;
      if (base === "le" || base === "be") {
        effectiveEndian = base;
        effectiveBase = 10;
      }
      if (typeof number === "number") {
        this.initNumber(number, effectiveEndian);
        return;
      }
      if (Array.isArray(number)) {
        this.initArray(number, effectiveEndian);
        return;
      }
      if (typeof number === "string") {
        if (effectiveBase === "hex")
          effectiveBase = 16;
        this.assert(typeof effectiveBase === "number" && effectiveBase === (effectiveBase | 0) && effectiveBase >= 2 && effectiveBase <= 36, "Base must be an integer between 2 and 36");
        const originalNumberStr = number.toString().replace(/\s+/g, "");
        let start = 0;
        let sign2 = 0;
        if (originalNumberStr.startsWith("-")) {
          start++;
          sign2 = 1;
        } else if (originalNumberStr.startsWith("+")) {
          start++;
        }
        const numStr = originalNumberStr.substring(start);
        if (numStr.length === 0) {
          this._initializeState(0n, sign2 === 1 && originalNumberStr.startsWith("-") ? 1 : 0);
          this.normSign();
          return;
        }
        if (effectiveBase === 16) {
          let tempMagnitude;
          if (effectiveEndian === "le") {
            const bytes2 = [];
            let hexStr = numStr;
            if (hexStr.length % 2 !== 0)
              hexStr = "0" + hexStr;
            for (let i = 0; i < hexStr.length; i += 2) {
              const byteHex = hexStr.substring(i, i + 2);
              const byteVal = parseInt(byteHex, 16);
              if (isNaN(byteVal))
                throw new Error("Invalid character in " + hexStr);
              bytes2.push(byteVal);
            }
            this.initArray(bytes2, "le");
            this._sign = sign2;
            this.normSign();
            return;
          } else {
            try {
              tempMagnitude = BigInt("0x" + numStr);
            } catch (e) {
              throw new Error("Invalid character in " + numStr);
            }
          }
          this._initializeState(tempMagnitude, sign2);
          this.normSign();
        } else {
          try {
            this._parseBaseString(numStr, effectiveBase);
            this._sign = sign2;
            this.normSign();
            if (effectiveEndian === "le") {
              const currentSign = this._sign;
              this.initArray(this.toArray("be"), "le");
              this._sign = currentSign;
              this.normSign();
            }
          } catch (err) {
            const error = err;
            if (error.message.includes("Invalid character in string") || error.message.includes("Invalid digit for base") || error.message.startsWith("Invalid character:")) {
              throw new Error("Invalid character");
            }
            throw error;
          }
        }
      } else if (number !== 0) {
        this.assert(false, "Unsupported input type for BigNumber constructor");
      } else {
        this._initializeState(0n, 0);
      }
    }
    /**
     * Negative flag. Indicates whether the big number is a negative number.
     * - If 0, the number is positive.
     * - If 1, the number is negative.
     *
     * @property negative
     */
    get negative() {
      return this._sign;
    }
    /**
     * Sets the negative flag. Only 0 (positive) or 1 (negative) are allowed.
     */
    set negative(val) {
      this.assert(val === 0 || val === 1, "Negative property must be 0 or 1");
      const newSign = val === 1 ? 1 : 0;
      if (this._magnitude === 0n) {
        this._sign = 0;
      } else {
        this._sign = newSign;
      }
    }
    get _computedWordsArray() {
      if (this._magnitude === 0n)
        return [0];
      const arr = [];
      let temp = this._magnitude;
      while (temp > 0n) {
        arr.push(Number(temp & _BigNumber.WORD_MASK));
        temp >>= _BigNumber.WORD_SIZE_BIGINT;
      }
      return arr.length > 0 ? arr : [0];
    }
    /**
     * Array of numbers, where each number represents a part of the value of the big number.
     *
     * @property words
     */
    get words() {
      const computed = this._computedWordsArray;
      if (this._nominalWordLength <= computed.length) {
        return computed;
      }
      const paddedWords = new Array(this._nominalWordLength).fill(0);
      for (let i = 0; i < computed.length; i++) {
        paddedWords[i] = computed[i];
      }
      return paddedWords;
    }
    /**
     * Sets the words array representing the value of the big number.
     */
    set words(newWords) {
      const oldSign = this._sign;
      let newMagnitude = 0n;
      const len = newWords.length > 0 ? newWords.length : 1;
      for (let i = len - 1; i >= 0; i--) {
        const wordVal = newWords[i] === void 0 ? 0 : newWords[i];
        newMagnitude = newMagnitude << _BigNumber.WORD_SIZE_BIGINT | BigInt(wordVal & Number(_BigNumber.WORD_MASK));
      }
      this._magnitude = newMagnitude;
      this._sign = oldSign;
      this._nominalWordLength = len;
      this.normSign();
    }
    /**
     * Length of the words array.
     *
     * @property length
     */
    get length() {
      return Math.max(1, this._nominalWordLength);
    }
    /**
     * Checks whether a value is an instance of BigNumber. Regular JS numbers fail this check.
     *
     * @method isBN
     * @param num - The value to be checked.
     * @returns - Returns a boolean value determining whether or not the checked num parameter is a BigNumber.
     */
    static isBN(num) {
      if (num instanceof _BigNumber)
        return true;
      return num !== null && typeof num === "object" && num.constructor?.wordSize === _BigNumber.wordSize && Array.isArray(num.words);
    }
    /**
     * Returns the bigger value between two BigNumbers
     *
     * @method max
     * @param left - The first BigNumber to be compared.
     * @param right - The second BigNumber to be compared.
     * @returns - Returns the bigger BigNumber between left and right.
     */
    static max(left, right) {
      return left.cmp(right) > 0 ? left : right;
    }
    /**
     * Returns the smaller value between two BigNumbers
     *
     * @method min
     * @param left - The first BigNumber to be compared.
     * @param right - The second BigNumber to be compared.
     * @returns - Returns the smaller value between left and right.
     */
    static min(left, right) {
      return left.cmp(right) < 0 ? left : right;
    }
    _bigIntToStringInBase(num, base) {
      if (num === 0n)
        return "0";
      if (base < 2 || base > 36)
        throw new Error("Base must be between 2 and 36");
      const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
      let result = "";
      let currentNum = num > 0n ? num : -num;
      const bigBase = BigInt(base);
      while (currentNum > 0n) {
        result = digits[Number(currentNum % bigBase)] + result;
        currentNum /= bigBase;
      }
      return result;
    }
    _parseBaseString(numberStr, base) {
      if (numberStr.length === 0) {
        this._magnitude = 0n;
        this._finishInitialization();
        return;
      }
      this._magnitude = 0n;
      const bigBase = BigInt(base);
      let groupSize = _BigNumber.groupSizes[base];
      let groupBaseBigInt = BigInt(_BigNumber.groupBases[base]);
      if (groupSize === 0 || groupBaseBigInt === 0n) {
        groupSize = Math.floor(Math.log(67108863) / Math.log(base));
        if (groupSize === 0)
          groupSize = 1;
        groupBaseBigInt = bigBase ** BigInt(groupSize);
      }
      let currentPos = 0;
      const totalLen = numberStr.length;
      let firstChunkLen = totalLen % groupSize;
      if (firstChunkLen === 0 && totalLen > 0)
        firstChunkLen = groupSize;
      if (firstChunkLen > 0) {
        const chunkStr = numberStr.substring(currentPos, currentPos + firstChunkLen);
        this._magnitude = BigInt(this._parseBaseWord(chunkStr, base));
        currentPos += firstChunkLen;
      }
      while (currentPos < totalLen) {
        const chunkStr = numberStr.substring(currentPos, currentPos + groupSize);
        const wordVal = BigInt(this._parseBaseWord(chunkStr, base));
        this._magnitude = this._magnitude * groupBaseBigInt + wordVal;
        currentPos += groupSize;
      }
      this._finishInitialization();
    }
    _parseBaseWord(str, base) {
      let r2 = 0;
      for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i);
        let digitVal;
        if (charCode >= 48 && charCode <= 57)
          digitVal = charCode - 48;
        else if (charCode >= 65 && charCode <= 90)
          digitVal = charCode - 65 + 10;
        else if (charCode >= 97 && charCode <= 122)
          digitVal = charCode - 97 + 10;
        else
          throw new Error("Invalid character: " + str[i]);
        if (digitVal >= base)
          throw new Error("Invalid character");
        r2 = r2 * base + digitVal;
      }
      return r2;
    }
    _initializeState(magnitude, sign2) {
      this._magnitude = magnitude;
      this._sign = magnitude === 0n ? 0 : sign2;
      this._finishInitialization();
    }
    _finishInitialization() {
      if (this._magnitude === 0n) {
        this._nominalWordLength = 1;
        this._sign = 0;
      } else {
        const bitLen = this._magnitude.toString(2).length;
        this._nominalWordLength = Math.max(1, Math.ceil(bitLen / _BigNumber.wordSize));
      }
    }
    assert(val, msg = "Assertion failed") {
      if (!val)
        throw new Error(msg);
    }
    initNumber(number, endian = "be") {
      this.assert(BigInt(Math.abs(number)) <= _BigNumber.MAX_NUMBER_CONSTRUCTOR_MAG_BIGINT, "The number is larger than 2 ^ 53 (unsafe)");
      this.assert(number % 1 === 0, "Number must be an integer for BigNumber conversion");
      this._initializeState(BigInt(Math.abs(number)), number < 0 ? 1 : 0);
      if (endian === "le") {
        const currentSign = this._sign;
        const beBytes = this.toArray("be");
        this.initArray(beBytes, "le");
        this._sign = currentSign;
        this.normSign();
      }
      return this;
    }
    initArray(bytes2, endian) {
      if (bytes2.length === 0) {
        this._initializeState(0n, 0);
        return this;
      }
      let magnitude = 0n;
      if (endian === "be") {
        for (let i = 0; i < bytes2.length; i++)
          magnitude = magnitude << 8n | BigInt(bytes2[i] & 255);
      } else {
        for (let i = bytes2.length - 1; i >= 0; i--)
          magnitude = magnitude << 8n | BigInt(bytes2[i] & 255);
      }
      this._initializeState(magnitude, 0);
      return this;
    }
    copy(dest) {
      dest._magnitude = this._magnitude;
      dest._sign = this._sign;
      dest._nominalWordLength = this._nominalWordLength;
      dest.red = this.red;
    }
    static move(dest, src) {
      dest._magnitude = src._magnitude;
      dest._sign = src._sign;
      dest._nominalWordLength = src._nominalWordLength;
      dest.red = src.red;
    }
    clone() {
      const r2 = new _BigNumber(0n);
      this.copy(r2);
      return r2;
    }
    expand(size) {
      this.assert(size >= 0, "Expand size must be non-negative");
      this._nominalWordLength = Math.max(this._nominalWordLength, size, 1);
      return this;
    }
    strip() {
      this._finishInitialization();
      return this.normSign();
    }
    normSign() {
      if (this._magnitude === 0n)
        this._sign = 0;
      return this;
    }
    inspect() {
      return (this.red !== null ? "<BN-R: " : "<BN: ") + this.toString(16) + ">";
    }
    _getMinimalHex() {
      if (this._magnitude === 0n)
        return "0";
      return this._magnitude.toString(16);
    }
    /**
     * Converts the BigNumber instance to a string representation.
     *
     * @method toString
     * @param base - The base for representing number. Default is 10. Other accepted values are 16 and 'hex'.
     * @param padding - Represents the minimum number of digits to represent the BigNumber as a string. Default is 1.
     * @returns The string representation of the BigNumber instance
     */
    toString(base = 10, padding = 1) {
      if (base === 16 || base === "hex") {
        let hexStr = this._getMinimalHex();
        if (padding > 1) {
          if (hexStr !== "0" && hexStr.length % 2 !== 0) {
            hexStr = "0" + hexStr;
          }
          while (hexStr.length % padding !== 0) {
            hexStr = "0" + hexStr;
          }
        }
        return (this.isNeg() ? "-" : "") + hexStr;
      }
      if (typeof base !== "number" || base < 2 || base > 36 || base % 1 !== 0)
        throw new Error("Base should be an integer between 2 and 36");
      return this.toBaseString(base, padding);
    }
    toBaseString(base, padding) {
      if (this._magnitude === 0n) {
        let out2 = "0";
        if (padding > 1) {
          while (out2.length < padding)
            out2 = "0" + out2;
        }
        return out2;
      }
      let groupSize = _BigNumber.groupSizes[base];
      let groupBaseBigInt = BigInt(_BigNumber.groupBases[base]);
      if (groupSize === 0 || groupBaseBigInt === 0n) {
        groupSize = Math.floor(Math.log(Number.MAX_SAFE_INTEGER) / Math.log(base));
        if (groupSize === 0)
          groupSize = 1;
        groupBaseBigInt = BigInt(base) ** BigInt(groupSize);
      }
      let out = "";
      let tempMag = this._magnitude;
      while (tempMag > 0n) {
        const remainder = tempMag % groupBaseBigInt;
        tempMag /= groupBaseBigInt;
        const chunkStr = this._bigIntToStringInBase(remainder, base);
        if (tempMag > 0n) {
          const zerosToPrepend = groupSize - chunkStr.length;
          if (zerosToPrepend > 0 && zerosToPrepend < _BigNumber.zeros.length) {
            out = _BigNumber.zeros[zerosToPrepend] + chunkStr + out;
          } else if (zerosToPrepend > 0) {
            out = "0".repeat(zerosToPrepend) + chunkStr + out;
          } else {
            out = chunkStr + out;
          }
        } else {
          out = chunkStr + out;
        }
      }
      if (padding > 0) {
        while (out.length < padding)
          out = "0" + out;
      }
      return (this._sign === 1 ? "-" : "") + out;
    }
    /**
     * Converts the BigNumber instance to a JavaScript number.
     * Please note that JavaScript numbers are only precise up to 53 bits.
     *
     * @method toNumber
     * @throws If the BigNumber instance cannot be safely stored in a JavaScript number
     * @returns The JavaScript number representation of the BigNumber instance.
     */
    toNumber() {
      const val = this._getSignedValue();
      if (val > _BigNumber.MAX_SAFE_INTEGER_BIGINT || val < _BigNumber.MIN_SAFE_INTEGER_BIGINT)
        throw new Error("Number can only safely store up to 53 bits");
      return Number(val);
    }
    /**
     * Returns the signed BigInt representation of this BigNumber without any safety checks.
     *
     * @method toBigInt
     * @returns bigint value for this BigNumber.
     */
    toBigInt() {
      return this._getSignedValue();
    }
    /**
     * Converts the BigNumber instance to a JSON-formatted string.
     *
     * @method toJSON
     * @returns The JSON string representation of the BigNumber instance.
     */
    toJSON() {
      const hex = this._getMinimalHex();
      return (this.isNeg() ? "-" : "") + hex;
    }
    toArrayLikeGeneric(res, isLE) {
      let tempMag = this._magnitude;
      let position = isLE ? 0 : res.length - 1;
      const increment = isLE ? 1 : -1;
      for (let k = 0; k < res.length; ++k) {
        if (tempMag === 0n && position >= 0 && position < res.length) {
          res[position] = 0;
        } else if (position >= 0 && position < res.length) {
          res[position] = Number(tempMag & 0xffn);
        } else {
          break;
        }
        tempMag >>= 8n;
        position += increment;
      }
    }
    /**
     * Converts the BigNumber instance to an array of bytes.
     *
     * @method toArray
     * @param endian - Endianness of the output array, defaults to 'be'.
     * @param length - Optional length of the output array.
     * @returns Array of bytes representing the BigNumber.
     */
    toArray(endian = "be", length) {
      this.strip();
      const actualByteLength = this.byteLength();
      const reqLength = length ?? Math.max(1, actualByteLength);
      this.assert(actualByteLength <= reqLength, "byte array longer than desired length");
      this.assert(reqLength > 0, "Requested array length <= 0");
      const res = new Array(reqLength).fill(0);
      if (this._magnitude === 0n && reqLength > 0)
        return res;
      if (this._magnitude === 0n && reqLength === 0)
        return [];
      this.toArrayLikeGeneric(res, endian === "le");
      return res;
    }
    /**
     * Calculates the number of bits required to represent the BigNumber.
     *
     * @method bitLength
     * @returns The bit length of the BigNumber.
     */
    bitLength() {
      if (this._magnitude === 0n)
        return 0;
      return this._magnitude.toString(2).length;
    }
    /**
     * Converts a BigNumber to an array of bits.
     *
     * @method toBitArray
     * @param num - The BigNumber to convert.
     * @returns An array of bits.
     */
    static toBitArray(num) {
      const len = num.bitLength();
      if (len === 0)
        return [];
      const w = new Array(len);
      const mag = num._magnitude;
      for (let bit = 0; bit < len; bit++) {
        w[bit] = (mag >> BigInt(bit) & 1n) !== 0n ? 1 : 0;
      }
      return w;
    }
    /**
     * Instance version of {@link toBitArray}.
     */
    toBitArray() {
      return _BigNumber.toBitArray(this);
    }
    /**
     * Returns the number of trailing zero bits in the big number.
     *
     * @method zeroBits
     * @returns Returns the number of trailing zero bits
     * in the binary representation of the big number.
     *
     * @example
     * const bn = new BigNumber('8'); // binary: 1000
     * const zeroBits = bn.zeroBits(); // 3
     */
    zeroBits() {
      if (this._magnitude === 0n)
        return 0;
      let c = 0;
      let t = this._magnitude;
      while ((t & 1n) === 0n && t !== 0n) {
        c++;
        t >>= 1n;
      }
      return c;
    }
    /**
     * Calculates the number of bytes required to represent the BigNumber.
     *
     * @method byteLength
     * @returns The byte length of the BigNumber.
     */
    byteLength() {
      if (this._magnitude === 0n)
        return 0;
      return Math.ceil(this.bitLength() / 8);
    }
    _getSignedValue() {
      return this._sign === 1 ? -this._magnitude : this._magnitude;
    }
    _setValueFromSigned(sVal) {
      if (sVal < 0n) {
        this._magnitude = -sVal;
        this._sign = 1;
      } else {
        this._magnitude = sVal;
        this._sign = 0;
      }
      this._finishInitialization();
      this.normSign();
    }
    toTwos(width) {
      this.assert(width >= 0);
      const Bw = BigInt(width);
      let v = this._getSignedValue();
      if (this._sign === 1 && this._magnitude !== 0n)
        v = (1n << Bw) + v;
      const m = (1n << Bw) - 1n;
      v &= m;
      const r2 = new _BigNumber(0n);
      r2._initializeState(v, 0);
      return r2;
    }
    fromTwos(width) {
      this.assert(width >= 0);
      const Bw = BigInt(width);
      const m = this._magnitude;
      if (width > 0 && (m >> Bw - 1n & 1n) !== 0n && this._sign === 0) {
        const sVal = m - (1n << Bw);
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(sVal);
        return r2;
      }
      return this.clone();
    }
    isNeg() {
      return this._sign === 1 && this._magnitude !== 0n;
    }
    neg() {
      return this.clone().ineg();
    }
    ineg() {
      if (this._magnitude !== 0n)
        this._sign = this._sign === 1 ? 0 : 1;
      return this;
    }
    _iuop(num, op) {
      const newMag = op(this._magnitude, num._magnitude);
      const isXor = op === ((a, b) => a ^ b);
      let targetNominalLength = this._nominalWordLength;
      if (isXor)
        targetNominalLength = Math.max(this.length, num.length);
      this._magnitude = newMag;
      this._finishInitialization();
      if (isXor)
        this._nominalWordLength = Math.max(this._nominalWordLength, targetNominalLength);
      return this.strip();
    }
    iuor(num) {
      return this._iuop(num, (a, b) => a | b);
    }
    iuand(num) {
      return this._iuop(num, (a, b) => a & b);
    }
    iuxor(num) {
      return this._iuop(num, (a, b) => a ^ b);
    }
    _iop(num, op) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._iuop(num, op);
    }
    ior(num) {
      return this._iop(num, (a, b) => a | b);
    }
    iand(num) {
      return this._iop(num, (a, b) => a & b);
    }
    ixor(num) {
      return this._iop(num, (a, b) => a ^ b);
    }
    _uop_new(num, opName) {
      if (this.length >= num.length)
        return this.clone()[opName](num);
      return num.clone()[opName](this);
    }
    or(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuor");
    }
    uor(num) {
      return this._uop_new(num, "iuor");
    }
    and(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuand");
    }
    uand(num) {
      return this._uop_new(num, "iuand");
    }
    xor(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuxor");
    }
    uxor(num) {
      return this._uop_new(num, "iuxor");
    }
    inotn(width) {
      this.assert(typeof width === "number" && width >= 0);
      const Bw = BigInt(width);
      const m = (1n << Bw) - 1n;
      this._magnitude = ~this._magnitude & m;
      const wfw = width === 0 ? 1 : Math.ceil(width / _BigNumber.wordSize);
      this._nominalWordLength = Math.max(1, wfw);
      this.strip();
      this._nominalWordLength = Math.max(this._nominalWordLength, Math.max(1, wfw));
      return this;
    }
    notn(width) {
      return this.clone().inotn(width);
    }
    setn(bit, val) {
      this.assert(typeof bit === "number" && bit >= 0);
      const Bb = BigInt(bit);
      if (val === 1 || val === true)
        this._magnitude |= 1n << Bb;
      else
        this._magnitude &= ~(1n << Bb);
      const wnb = Math.floor(bit / _BigNumber.wordSize) + 1;
      this._nominalWordLength = Math.max(this._nominalWordLength, wnb);
      this._finishInitialization();
      return this.strip();
    }
    iadd(num) {
      this._setValueFromSigned(this._getSignedValue() + num._getSignedValue());
      return this;
    }
    add(num) {
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(this._getSignedValue() + num._getSignedValue());
      return r2;
    }
    isub(num) {
      this._setValueFromSigned(this._getSignedValue() - num._getSignedValue());
      return this;
    }
    sub(num) {
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(this._getSignedValue() - num._getSignedValue());
      return r2;
    }
    mul(num) {
      const r2 = new _BigNumber(0n);
      r2._magnitude = this._magnitude * num._magnitude;
      r2._sign = r2._magnitude === 0n ? 0 : this._sign ^ num._sign;
      r2._nominalWordLength = this.length + num.length;
      r2.red = null;
      return r2.normSign();
    }
    imul(num) {
      this._magnitude *= num._magnitude;
      this._sign = this._magnitude === 0n ? 0 : this._sign ^ num._sign;
      this._nominalWordLength = this.length + num.length;
      this.red = null;
      return this.normSign();
    }
    imuln(num) {
      this.assert(typeof num === "number", "Assertion failed");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Assertion failed");
      this._setValueFromSigned(this._getSignedValue() * BigInt(num));
      return this;
    }
    muln(num) {
      return this.clone().imuln(num);
    }
    sqr() {
      const r2 = new _BigNumber(0n);
      r2._magnitude = this._magnitude * this._magnitude;
      r2._sign = 0;
      r2._nominalWordLength = this.length * 2;
      r2.red = null;
      return r2;
    }
    isqr() {
      this._magnitude *= this._magnitude;
      this._sign = 0;
      this._nominalWordLength = this.length * 2;
      this.red = null;
      return this;
    }
    pow(num) {
      this.assert(num._sign === 0, "Exponent for pow must be non-negative");
      if (num.isZero())
        return new _BigNumber(1n);
      const res = new _BigNumber(1n);
      const currentBase = this.clone();
      const exp = num.clone();
      const baseIsNegative = currentBase.isNeg();
      const expIsOdd = exp.isOdd();
      if (baseIsNegative)
        currentBase.ineg();
      while (!exp.isZero()) {
        if (exp.isOdd()) {
          res.imul(currentBase);
        }
        currentBase.isqr();
        exp.iushrn(1);
      }
      if (baseIsNegative && expIsOdd) {
        res.ineg();
      }
      return res;
    }
    static normalizeNonNegativeBigInt(value, label) {
      if (typeof value === "number") {
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)
          throw new Error(`${label} must be a non-negative integer`);
        return BigInt(value);
      }
      if (value < 0n)
        throw new Error(`${label} must be a non-negative integer`);
      return value;
    }
    iushln(bits) {
      const normalizedBits = _BigNumber.normalizeNonNegativeBigInt(bits, "Shift bits");
      if (normalizedBits === 0n)
        return this;
      this._magnitude <<= normalizedBits;
      this._finishInitialization();
      return this.strip();
    }
    ishln(bits) {
      this.assert(this._sign === 0, "ishln requires positive number");
      return this.iushln(bits);
    }
    iushrn(bits, hint, extended) {
      const normalizedBits = _BigNumber.normalizeNonNegativeBigInt(bits, "Shift bits");
      if (normalizedBits === 0n) {
        if (extended != null)
          extended._initializeState(0n, 0);
        return this;
      }
      if (extended != null) {
        const m = (1n << normalizedBits) - 1n;
        const sOut = this._magnitude & m;
        extended._initializeState(sOut, 0);
      }
      this._magnitude >>= normalizedBits;
      this._finishInitialization();
      return this.strip();
    }
    ishrn(bits, hint, extended) {
      this.assert(this._sign === 0, "ishrn requires positive number");
      return this.iushrn(bits, hint, extended);
    }
    shln(bits) {
      return this.clone().ishln(bits);
    }
    ushln(bits) {
      return this.clone().iushln(bits);
    }
    shrn(bits) {
      return this.clone().ishrn(bits);
    }
    ushrn(bits) {
      return this.clone().iushrn(bits);
    }
    testn(bit) {
      this.assert(typeof bit === "number" && bit >= 0);
      return (this._magnitude >> BigInt(bit) & 1n) !== 0n;
    }
    imaskn(bits) {
      this.assert(typeof bits === "number" && bits >= 0);
      this.assert(this._sign === 0, "imaskn works only with positive numbers");
      const Bb = BigInt(bits);
      const m = Bb === 0n ? 0n : (1n << Bb) - 1n;
      this._magnitude &= m;
      const wfm = bits === 0 ? 1 : Math.max(1, Math.ceil(bits / _BigNumber.wordSize));
      this._nominalWordLength = wfm;
      this._finishInitialization();
      this._nominalWordLength = Math.max(this._nominalWordLength, wfm);
      return this.strip();
    }
    maskn(bits) {
      return this.clone().imaskn(bits);
    }
    iaddn(num) {
      this.assert(typeof num === "number");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "num is too large");
      this._setValueFromSigned(this._getSignedValue() + BigInt(num));
      return this;
    }
    _iaddn(num) {
      return this.iaddn(num);
    }
    isubn(num) {
      this.assert(typeof num === "number");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Assertion failed");
      this._setValueFromSigned(this._getSignedValue() - BigInt(num));
      return this;
    }
    addn(num) {
      return this.clone().iaddn(num);
    }
    subn(num) {
      return this.clone().isubn(num);
    }
    iabs() {
      this._sign = 0;
      return this;
    }
    abs() {
      return this.clone().iabs();
    }
    divmod(num, mode, positive) {
      this.assert(!num.isZero(), "Division by zero");
      if (this.isZero()) {
        const z = new _BigNumber(0n);
        return { div: mode !== "mod" ? z : null, mod: mode !== "div" ? z : null };
      }
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      let dV = null;
      let mV = null;
      if (mode !== "mod")
        dV = tV / nV;
      if (mode !== "div") {
        mV = tV % nV;
        if (positive === true && mV < 0n)
          mV += nV < 0n ? -nV : nV;
      }
      const rd = dV !== null ? new _BigNumber(0n) : null;
      if (rd !== null && dV !== null)
        rd._setValueFromSigned(dV);
      const rm = mV !== null ? new _BigNumber(0n) : null;
      if (rm !== null && mV !== null)
        rm._setValueFromSigned(mV);
      return { div: rd, mod: rm };
    }
    div(num) {
      return this.divmod(num, "div", false).div;
    }
    mod(num) {
      return this.divmod(num, "mod", false).mod;
    }
    umod(num) {
      return this.divmod(num, "mod", true).mod;
    }
    divRound(num) {
      this.assert(!num.isZero());
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      let d = tV / nV;
      const m = tV % nV;
      if (m === 0n) {
        const r3 = new _BigNumber(0n);
        r3._setValueFromSigned(d);
        return r3;
      }
      const absM = m < 0n ? -m : m;
      const absNV = nV < 0n ? -nV : nV;
      if (absM * 2n >= absNV) {
        if (tV > 0n && nV > 0n || tV < 0n && nV < 0n) {
          d += 1n;
        } else {
          d -= 1n;
        }
      }
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(d);
      return r2;
    }
    modrn(numArg) {
      this.assert(numArg !== 0, "Division by zero in modrn");
      const absDivisor = BigInt(Math.abs(numArg));
      if (absDivisor === 0n)
        throw new Error("Division by zero in modrn");
      const remainderMag = this._magnitude % absDivisor;
      return numArg < 0 ? Number(-remainderMag) : Number(remainderMag);
    }
    idivn(num) {
      this.assert(num !== 0);
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "num is too large");
      this._setValueFromSigned(this._getSignedValue() / BigInt(num));
      return this;
    }
    divn(num) {
      return this.clone().idivn(num);
    }
    egcd(p) {
      this.assert(p._sign === 0, "p must not be negative");
      this.assert(!p.isZero(), "p must not be zero");
      let uV = this._getSignedValue();
      let vV = p._magnitude;
      let a = 1n;
      let pa = 0n;
      let b = 0n;
      let pb = 1n;
      while (vV !== 0n) {
        const q = uV / vV;
        let t = vV;
        vV = uV % vV;
        uV = t;
        t = pa;
        pa = a - q * pa;
        a = t;
        t = pb;
        pb = b - q * pb;
        b = t;
      }
      const ra = new _BigNumber(0n);
      ra._setValueFromSigned(a);
      const rb = new _BigNumber(0n);
      rb._setValueFromSigned(b);
      const rg = new _BigNumber(0n);
      rg._initializeState(uV < 0n ? -uV : uV, 0);
      return { a: ra, b: rb, gcd: rg };
    }
    gcd(num) {
      let u = this._magnitude;
      let v = num._magnitude;
      if (u === 0n) {
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(v);
        return r2.iabs();
      }
      if (v === 0n) {
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(u);
        return r2.iabs();
      }
      while (v !== 0n) {
        const t = u % v;
        u = v;
        v = t;
      }
      const res = new _BigNumber(0n);
      res._initializeState(u, 0);
      return res;
    }
    invm(num) {
      this.assert(!num.isZero() && num._sign === 0, "Modulus for invm must be positive and non-zero");
      const eg = this.egcd(num);
      if (!eg.gcd.eqn(1)) {
        throw new Error("Inverse does not exist (numbers are not coprime).");
      }
      return eg.a.umod(num);
    }
    isEven() {
      return this._magnitude % 2n === 0n;
    }
    isOdd() {
      return this._magnitude % 2n === 1n;
    }
    andln(num) {
      this.assert(num >= 0);
      return Number(this._magnitude & BigInt(num));
    }
    bincn(bit) {
      this.assert(typeof bit === "number" && bit >= 0);
      const BVal = 1n << BigInt(bit);
      this._setValueFromSigned(this._getSignedValue() + BVal);
      return this;
    }
    isZero() {
      return this._magnitude === 0n;
    }
    cmpn(num) {
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Number is too big");
      const tV = this._getSignedValue();
      const nV = BigInt(num);
      if (tV < nV)
        return -1;
      if (tV > nV)
        return 1;
      return 0;
    }
    cmp(num) {
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      if (tV < nV)
        return -1;
      if (tV > nV)
        return 1;
      return 0;
    }
    ucmp(num) {
      if (this._magnitude < num._magnitude)
        return -1;
      if (this._magnitude > num._magnitude)
        return 1;
      return 0;
    }
    gtn(num) {
      return this.cmpn(num) === 1;
    }
    gt(num) {
      return this.cmp(num) === 1;
    }
    gten(num) {
      return this.cmpn(num) >= 0;
    }
    gte(num) {
      return this.cmp(num) >= 0;
    }
    ltn(num) {
      return this.cmpn(num) === -1;
    }
    lt(num) {
      return this.cmp(num) === -1;
    }
    lten(num) {
      return this.cmpn(num) <= 0;
    }
    lte(num) {
      return this.cmp(num) <= 0;
    }
    eqn(num) {
      return this.cmpn(num) === 0;
    }
    eq(num) {
      return this.cmp(num) === 0;
    }
    toRed(ctx) {
      this.assert(this.red == null, "Already a number in reduction context");
      this.assert(this._sign === 0, "toRed works only with positives");
      return ctx.convertTo(this).forceRed(ctx);
    }
    fromRed() {
      this.assert(this.red, "fromRed works only with numbers in reduction context");
      return this.red.convertFrom(this);
    }
    forceRed(ctx) {
      this.red = ctx;
      return this;
    }
    redAdd(num) {
      this.assert(this.red, "redAdd works only with red numbers");
      return this.red.add(this, num);
    }
    redIAdd(num) {
      this.assert(this.red, "redIAdd works only with red numbers");
      return this.red.iadd(this, num);
    }
    redSub(num) {
      this.assert(this.red, "redSub works only with red numbers");
      return this.red.sub(this, num);
    }
    redISub(num) {
      this.assert(this.red, "redISub works only with red numbers");
      return this.red.isub(this, num);
    }
    redShl(num) {
      this.assert(this.red, "redShl works only with red numbers");
      return this.red.shl(this, num);
    }
    redMul(num) {
      this.assert(this.red, "redMul works only with red numbers");
      this.red.verify2(this, num);
      return this.red.mul(this, num);
    }
    redIMul(num) {
      this.assert(this.red, "redIMul works only with red numbers");
      this.red.verify2(this, num);
      return this.red.imul(this, num);
    }
    redSqr() {
      this.assert(this.red, "redSqr works only with red numbers");
      this.red.verify1(this);
      return this.red.sqr(this);
    }
    redISqr() {
      this.assert(this.red, "redISqr works only with red numbers");
      this.red.verify1(this);
      return this.red.isqr(this);
    }
    redSqrt() {
      this.assert(this.red, "redSqrt works only with red numbers");
      this.red.verify1(this);
      return this.red.sqrt(this);
    }
    redInvm() {
      this.assert(this.red, "redInvm works only with red numbers");
      this.red.verify1(this);
      return this.red.invm(this);
    }
    redNeg() {
      this.assert(this.red, "redNeg works only with red numbers");
      this.red.verify1(this);
      return this.red.neg(this);
    }
    redPow(num) {
      this.assert(this.red != null && num.red == null, "redPow(normalNum)");
      this.red.verify1(this);
      return this.red.pow(this, num);
    }
    /**
     * Creates a BigNumber from a hexadecimal string.
     *
     * @static
     * @method fromHex
     * @param hex - The hexadecimal string to create a BigNumber from.
     * @param endian - Optional endianness for parsing the hex string.
     * @returns Returns a BigNumber created from the hexadecimal input string.
     *
     * @example
     * const exampleHex = 'a1b2c3';
     * const bigNumber = BigNumber.fromHex(exampleHex);
     */
    static fromHex(hex, endian) {
      let eE = "be";
      if (endian === "little" || endian === "le")
        eE = "le";
      return new _BigNumber(hex, 16, eE);
    }
    /**
     * Converts this BigNumber to a hexadecimal string.
     *
     * @method toHex
     * @param length - The minimum length of the hex string
     * @returns Returns a string representing the hexadecimal value of this BigNumber.
     *
     * @example
     * const bigNumber = new BigNumber(255)
     * const hex = bigNumber.toHex()
     */
    toHex(byteLength = 0) {
      if (this.isZero() && byteLength === 0)
        return "";
      let hexStr = this._getMinimalHex();
      if (hexStr !== "0" && hexStr.length % 2 !== 0) {
        hexStr = "0" + hexStr;
      }
      const minChars = byteLength * 2;
      while (hexStr.length < minChars) {
        hexStr = "0" + hexStr;
      }
      return (this.isNeg() ? "-" : "") + hexStr;
    }
    /**
     * Creates a BigNumber from a JSON-serialized string.
     *
     * @static
     * @method fromJSON
     * @param str - The JSON-serialized string to create a BigNumber from.
     * @returns Returns a BigNumber created from the JSON input string.
     */
    static fromJSON(str) {
      return new _BigNumber(str, 16);
    }
    /**
     * Creates a BigNumber from a number.
     *
     * @static
     * @method fromNumber
     * @param n - The number to create a BigNumber from.
     * @returns Returns a BigNumber equivalent to the input number.
     */
    static fromNumber(n) {
      return new _BigNumber(n);
    }
    /**
     * Creates a BigNumber from a string, considering an optional base.
     *
     * @static
     * @method fromString
     * @param str - The string to create a BigNumber from.
     * @param base - The base used for conversion. If not provided, base 10 is assumed.
     * @returns Returns a BigNumber equivalent to the string after conversion from the specified base.
     */
    static fromString(str, base) {
      return new _BigNumber(str, base);
    }
    /**
     * Creates a BigNumber from a signed magnitude number.
     *
     * @static
     * @method fromSm
     * @param bytes - The signed magnitude number to convert to a BigNumber.
     * @param endian - Defines endianess. If not provided, big endian is assumed.
     * @returns Returns a BigNumber equivalent to the signed magnitude number interpreted with specified endianess.
     */
    static fromSm(bytes2, endian = "big") {
      if (bytes2.length === 0)
        return new _BigNumber(0n);
      const beBytes = bytes2.slice();
      if (endian === "little") {
        beBytes.reverse();
      }
      let sign2 = 0;
      if (beBytes.length > 0 && (beBytes[0] & 128) !== 0) {
        sign2 = 1;
        beBytes[0] &= 127;
      }
      let magnitude = 0n;
      if (CAN_USE_BUFFER) {
        const hex = BufferCtor.from(beBytes).toString("hex");
        magnitude = hex.length === 0 ? 0n : BigInt("0x" + hex);
      } else {
        let hex = "";
        for (const byte of beBytes) {
          hex += byte < 16 ? "0" + byte.toString(16) : byte.toString(16);
        }
        magnitude = hex.length === 0 ? 0n : BigInt("0x" + hex);
      }
      const r2 = new _BigNumber(0n);
      r2._initializeState(magnitude, sign2);
      return r2;
    }
    /**
     * Converts this BigNumber to a signed magnitude number.
     *
     * @method toSm
     * @param endian - Defines endianess. If not provided, big endian is assumed.
     * @returns Returns an array equivalent to this BigNumber interpreted as a signed magnitude with specified endianess.
     */
    toSm(endian = "big") {
      if (this._magnitude === 0n) {
        return this._sign === 1 ? [128] : [];
      }
      let hex = this._getMinimalHex();
      if (hex.length % 2 !== 0)
        hex = "0" + hex;
      const byteLen = hex.length / 2;
      const bytes2 = new Array(byteLen);
      for (let i = 0, j = 0; i < hex.length; i += 2) {
        const high = HEX_CHAR_TO_VALUE[hex.charCodeAt(i)];
        const low = HEX_CHAR_TO_VALUE[hex.charCodeAt(i + 1)];
        bytes2[j++] = (high & 15) << 4 | low & 15;
      }
      let result;
      if (this._sign === 1) {
        if ((bytes2[0] & 128) !== 0) {
          result = [128, ...bytes2];
        } else {
          result = bytes2.slice();
          result[0] |= 128;
        }
      } else if ((bytes2[0] & 128) !== 0) {
        result = [0, ...bytes2];
      } else {
        result = bytes2.slice();
      }
      return endian === "little" ? result.reverse() : result;
    }
    /**
     * Creates a BigNumber from a number representing the "bits" value in a block header.
     *
     * @static
     * @method fromBits
     * @param bits - The number representing the bits value in a block header.
     * @param strict - If true, an error is thrown if the number has negative bit set.
     * @returns Returns a BigNumber equivalent to the "bits" value in a block header.
     * @throws Will throw an error if `strict` is `true` and the number has negative bit set.
     */
    static fromBits(bits, strict = false) {
      const nSize = bits >>> 24;
      const nWordCompact = bits & 8388607;
      const isNegativeFromBit = (bits & 8388608) !== 0;
      if (strict && isNegativeFromBit) {
        throw new Error("negative bit set");
      }
      if (nSize === 0 && nWordCompact === 0) {
        if (isNegativeFromBit && strict)
          throw new Error("negative bit set for zero value");
        return new _BigNumber(0n);
      }
      const bn = new _BigNumber(nWordCompact);
      if (nSize <= 3) {
        bn.iushrn((3 - nSize) * 8);
      } else {
        bn.iushln((nSize - 3) * 8);
      }
      if (isNegativeFromBit) {
        bn.ineg();
      }
      return bn;
    }
    /**
     * Converts this BigNumber to a number representing the "bits" value in a block header.
     *
     * @method toBits
     * @returns Returns a number equivalent to the "bits" value in a block header.
     */
    toBits() {
      this.strip();
      if (this.isZero() && !this.isNeg())
        return 0;
      const isActualNegative = this.isNeg();
      const bnAbs = this.abs();
      let mB = bnAbs.toArray("be");
      let firstNonZeroIdx = 0;
      while (firstNonZeroIdx < mB.length - 1 && mB[firstNonZeroIdx] === 0) {
        firstNonZeroIdx++;
      }
      mB = mB.slice(firstNonZeroIdx);
      let nSize = mB.length;
      if (nSize === 0 && !bnAbs.isZero()) {
        mB = [0];
        nSize = 1;
      }
      if (bnAbs.isZero()) {
        nSize = 0;
        mB = [];
      }
      let nWordNum;
      if (nSize === 0) {
        nWordNum = 0;
      } else if (nSize <= 3) {
        nWordNum = 0;
        for (let i = 0; i < nSize; i++) {
          nWordNum = nWordNum << 8 | mB[i];
        }
      } else {
        nWordNum = mB[0] << 16 | mB[1] << 8 | mB[2];
      }
      if ((nWordNum & 8388608) !== 0 && nSize <= 255) {
        nWordNum >>>= 8;
        nSize++;
      }
      let b = nSize << 24 | nWordNum;
      if (isActualNegative)
        b |= 8388608;
      return b >>> 0;
    }
    /**
     * Creates a BigNumber from the format used in Bitcoin scripts.
     *
     * @static
     * @method fromScriptNum
     * @param num - The number in the format used in Bitcoin scripts.
     * @param requireMinimal - If true, non-minimally encoded values will throw an error.
     * @param maxNumSize - The maximum allowed size for the number.
     * @returns Returns a BigNumber equivalent to the number used in a Bitcoin script.
     */
    static fromScriptNum(num, requireMinimal = false, maxNumSize) {
      if (maxNumSize !== void 0 && num.length > maxNumSize)
        throw new Error("script number overflow");
      if (num.length === 0)
        return new _BigNumber(0n);
      if (requireMinimal) {
        if ((num[num.length - 1] & 127) === 0) {
          if (num.length <= 1 || (num[num.length - 2] & 128) === 0) {
            throw new Error("non-minimally encoded script number");
          }
        }
      }
      return _BigNumber.fromSm(num, "little");
    }
    /**
     * Converts this BigNumber to a number in the format used in Bitcoin scripts.
     *
     * @method toScriptNum
     * @returns Returns the equivalent to this BigNumber as a Bitcoin script number.
     */
    toScriptNum() {
      return this.toSm("little");
    }
    /**
     * Compute the multiplicative inverse of the current BigNumber in the modulus field specified by `p`.
     * The multiplicative inverse is a number which when multiplied with the current BigNumber gives '1' in the modulus field.
     *
     * @method _invmp
     * @param p - The `BigNumber` specifying the modulus field.
     * @returns The multiplicative inverse `BigNumber` in the modulus field specified by `p`.
     */
    /**
     * SECURITY NOTE:
     * This implementation avoids variable-time extended Euclidean algorithms
     * to reduce timing side-channel leakage. However, JavaScript BigInt arithmetic
     * does not provide constant-time guarantees. This implementation is suitable
     * for browser and single-tenant environments but is not hardened against
     * high-resolution timing attacks in shared CPU contexts.
    */
    _invmp(p) {
      this.assert(p._sign === 0, "p must not be negative for _invmp");
      this.assert(!p.isZero(), "p must not be zero for _invmp");
      const a = this.umod(p);
      const exp = p.subn(2);
      if (a.red !== null) {
        return a.redPow(exp);
      }
      let result = new _BigNumber(1n);
      let base = a.clone();
      const e = exp.clone();
      while (!e.isZero()) {
        if (e.isOdd())
          result = result.mul(base).umod(p);
        base = base.sqr().umod(p);
        e.iushrn(1);
      }
      return result;
    }
    /**
     * Performs multiplication between the BigNumber instance and a given BigNumber.
     * It chooses the multiplication method based on the lengths of the numbers to optimize execution time.
     *
     * @method mulTo
     * @param num - The BigNumber multiply with.
     * @param out - The BigNumber where to store the result.
     * @returns The BigNumber resulting from the multiplication operation.
     */
    mulTo(num, out) {
      out._magnitude = this._magnitude * num._magnitude;
      out._sign = out._magnitude === 0n ? 0 : this._sign ^ num._sign;
      out._nominalWordLength = this.length + num.length;
      out.red = null;
      out.normSign();
      return out;
    }
  };
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "zeros", [
    "",
    "0",
    "00",
    "000",
    "0000",
    "00000",
    "000000",
    "0000000",
    "00000000",
    "000000000",
    "0000000000",
    "00000000000",
    "000000000000",
    "0000000000000",
    "00000000000000",
    "000000000000000",
    "0000000000000000",
    "00000000000000000",
    "000000000000000000",
    "0000000000000000000",
    "00000000000000000000",
    "000000000000000000000",
    "0000000000000000000000",
    "00000000000000000000000",
    "000000000000000000000000",
    "0000000000000000000000000"
  ]);
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "groupSizes", [
    0,
    0,
    25,
    16,
    12,
    11,
    10,
    9,
    8,
    8,
    7,
    7,
    7,
    7,
    6,
    6,
    6,
    6,
    6,
    6,
    6,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5
  ]);
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "groupBases", [
    0,
    0,
    33554432,
    43046721,
    16777216,
    48828125,
    60466176,
    40353607,
    16777216,
    43046721,
    1e7,
    19487171,
    35831808,
    62748517,
    7529536,
    11390625,
    16777216,
    24137569,
    34012224,
    47045881,
    64e6,
    4084101,
    5153632,
    6436343,
    7962624,
    9765625,
    11881376,
    14348907,
    17210368,
    20511149,
    243e5,
    28629151,
    33554432,
    39135393,
    45435424,
    52521875,
    60466176
  ]);
  /**
   * The word size of big number chunks.
   *
   * @property wordSize
   *
   * @example
   * console.log(BigNumber.wordSize);  // output: 26
   */
  __publicField(_BigNumber, "wordSize", 26);
  __publicField(_BigNumber, "WORD_SIZE_BIGINT", BigInt(_BigNumber.wordSize));
  __publicField(_BigNumber, "WORD_MASK", (1n << _BigNumber.WORD_SIZE_BIGINT) - 1n);
  __publicField(_BigNumber, "MAX_SAFE_INTEGER_BIGINT", BigInt(Number.MAX_SAFE_INTEGER));
  __publicField(_BigNumber, "MIN_SAFE_INTEGER_BIGINT", BigInt(Number.MIN_SAFE_INTEGER));
  __publicField(_BigNumber, "MAX_IMULN_ARG", 67108864 - 1);
  __publicField(_BigNumber, "MAX_NUMBER_CONSTRUCTOR_MAG_BIGINT", (1n << 53n) - 1n);
  var BigNumber = _BigNumber;

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Mersenne.js
  var Mersenne = class {
    /**
     * @constructor
     * @param name - An identifier for the Mersenne instance.
     * @param p - A string representation of the pseudo-Mersenne prime, expressed in hexadecimal.
     *
     * @example
     * const mersenne = new Mersenne('M31', '7FFFFFFF');
     */
    constructor(name, p) {
      __publicField(this, "name");
      __publicField(this, "p");
      __publicField(this, "k");
      __publicField(this, "n");
      __publicField(this, "tmp");
      this.name = name;
      this.p = new BigNumber(p, 16);
      this.n = this.p.bitLength();
      this.k = new BigNumber(BigInt(1)).iushln(this.n).isub(this.p);
      this.tmp = this._tmp();
    }
    /**
     * Creates a temporary BigNumber structure for computations,
     * ensuring the appropriate number of words are initially allocated.
     *
     * @method _tmp
     * @returns A BigNumber with scaled size depending on prime magnitude.
     */
    _tmp() {
      const tmp = new BigNumber(BigInt(0));
      const requiredWords = Math.ceil(this.n / BigNumber.wordSize);
      tmp.expand(Math.max(1, requiredWords));
      return tmp;
    }
    /**
     * Reduces an input BigNumber in place, under the assumption that
     * it is less than the square of the pseudo-Mersenne prime.
     *
     * @method ireduce
     * @param num - The BigNumber to be reduced.
     * @returns The reduced BigNumber.
     *
     * @example
     * const reduced = mersenne.ireduce(new BigNumber('2345', 16));
     */
    ireduce(num) {
      const r2 = num;
      let rlen;
      do {
        this.split(r2, this.tmp);
        this.imulK(r2);
        r2.iadd(this.tmp);
        rlen = r2.bitLength();
      } while (rlen > this.n);
      const cmp = rlen < this.n ? -1 : r2.ucmp(this.p);
      if (cmp === 0) {
        r2.words = [0];
      } else if (cmp > 0) {
        r2.isub(this.p);
      }
      r2.strip();
      return r2;
    }
    /**
     * Shifts bits of the input BigNumber to the right, in place,
     * to meet the magnitude of the pseudo-Mersenne prime.
     *
     * @method split
     * @param input - The BigNumber to be shifted (will contain HI part).
     * @param out - The BigNumber to hold the shifted result (LO part).
     *
     * @example
     * mersenne.split(new BigNumber('2345', 16), new BigNumber());
     */
    split(input, out) {
      input.iushrn(this.n, 0, out);
    }
    /**
     * Performs an in-place multiplication of the parameter by constant k.
     *
     * @method imulK
     * @param num - The BigNumber to multiply with k.
     * @returns The result of the multiplication, in BigNumber format.
     *
     * @example
     * const multiplied = mersenne.imulK(new BigNumber('2345', 16));
     */
    imulK(num) {
      return num.imul(this.k);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/K256.js
  var K256 = class extends Mersenne {
    /**
     * Constructor for the K256 class.
     * Creates an instance of K256 using the super constructor from Mersenne.
     *
     * @constructor
     *
     * @example
     * const k256 = new K256();
     */
    constructor() {
      super("k256", "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f");
    }
    /**
     * Splits a BigNumber into a new BigNumber based on specific computation
     * rules. This method modifies the input and output big numbers.
     *
     * @method split
     * @param input - The BigNumber to be split.
     * @param output - The BigNumber that results from the split.
     *
     * @example
     * const input = new BigNumber(3456);
     * const output = new BigNumber(0);
     * k256.split(input, output);
     */
    split(input, output) {
      const mask = 4194303;
      const inputWords = input.words;
      const inputNominalLength = input.length;
      const outLen = Math.min(inputNominalLength, 9);
      const tempOutputWords = new Array(outLen + (inputNominalLength > 9 ? 1 : 0)).fill(0);
      for (let i = 0; i < outLen; i++) {
        tempOutputWords[i] = inputWords[i];
      }
      let currentOutputWordCount = outLen;
      if (inputNominalLength <= 9) {
        const finalOutputWords2 = new Array(currentOutputWordCount);
        for (let i = 0; i < currentOutputWordCount; ++i)
          finalOutputWords2[i] = tempOutputWords[i];
        output.words = finalOutputWords2;
        input.words = [0];
        return;
      }
      let prev = inputWords[9];
      tempOutputWords[currentOutputWordCount++] = prev & mask;
      const finalOutputWords = new Array(currentOutputWordCount);
      for (let i = 0; i < currentOutputWordCount; ++i)
        finalOutputWords[i] = tempOutputWords[i];
      output.words = finalOutputWords;
      const tempInputNewWords = new Array(Math.max(1, inputNominalLength - 9)).fill(0);
      let currentInputNewWordCount = 0;
      for (let i = 10; i < inputNominalLength; i++) {
        const next = inputWords[i] | 0;
        if (currentInputNewWordCount < tempInputNewWords.length) {
          tempInputNewWords[currentInputNewWordCount++] = (next & mask) << 4 | prev >>> 22;
        }
        prev = next;
      }
      prev >>>= 22;
      if (currentInputNewWordCount < tempInputNewWords.length) {
        tempInputNewWords[currentInputNewWordCount++] = prev;
      } else if (prev !== 0 && tempInputNewWords.length > 0) {
      }
      const finalInputNewWords = new Array(currentInputNewWordCount);
      for (let i = 0; i < currentInputNewWordCount; ++i)
        finalInputNewWords[i] = tempInputNewWords[i];
      input.words = finalInputNewWords;
    }
    /**
     * Multiplies a BigNumber ('num') with the constant 'K' in-place and returns the result.
     * 'K' is equal to 0x1000003d1 or in decimal representation: [ 64, 977 ].
     *
     * @method imulK
     * @param num - The BigNumber to multiply with K.
     * @returns Returns the mutated BigNumber after multiplication.
     *
     * @example
     * const number = new BigNumber(12345);
     * const result = k256.imulK(number);
     */
    imulK(num) {
      const currentWords = num.words;
      const originalNominalLength = num.length;
      const newNominalLength = originalNominalLength + 2;
      const tempWords = new Array(newNominalLength).fill(0);
      for (let i = 0; i < originalNominalLength; i++) {
        tempWords[i] = currentWords[i];
      }
      let lo = 0;
      for (let i = 0; i < newNominalLength; i++) {
        const w = tempWords[i] | 0;
        lo += w * 977;
        tempWords[i] = lo & 67108863;
        lo = w * 64 + (lo / 67108864 | 0);
      }
      num.words = tempWords;
      return num;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ReductionContext.js
  var ReductionContext = class {
    /**
     * Constructs a new ReductionContext.
     *
     * @constructor
     * @param m - A BigNumber representing the modulus, or 'k256' to create a context for Koblitz curve.
     *
     * @example
     * new ReductionContext(new BigNumber(11));
     * new ReductionContext('k256');
     */
    constructor(m) {
      __publicField(this, "prime");
      __publicField(this, "m");
      if (m === "k256") {
        const prime = new K256();
        this.m = prime.p;
        this.prime = prime;
      } else {
        this.assert(m.gtn(1), "modulus must be greater than 1");
        this.m = m;
        this.prime = null;
      }
    }
    /**
     * Asserts that given value is truthy. Throws an Error with a provided message
     * if the value is falsy.
     *
     * @private
     * @param val - The value to be checked.
     * @param msg - The error message to be thrown if the value is falsy.
     *
     * @example
     * this.assert(1 < 2, '1 is not less than 2');
     * this.assert(2 < 1, '2 is less than 1'); // throws an Error with message '2 is less than 1'
     */
    assert(val, msg = "Assertion failed") {
      if (!val)
        throw new Error(msg);
    }
    /**
     * Verifies that a BigNumber is positive and red. Throws an error if these
     * conditions are not met.
     *
     * @param a - The BigNumber to be verified.
     *
     * @example
     * this.verify1(new BigNumber(10).toRed());
     * this.verify1(new BigNumber(-10).toRed()); //throws an Error
     * this.verify1(new BigNumber(10)); //throws an Error
     */
    verify1(a) {
      this.assert(a.negative === 0, "red works only with positives");
      this.assert(a.red, "red works only with red numbers");
    }
    /**
     * Verifies that two BigNumbers are both positive and red. Also checks
     * that they have the same reduction context. Throws an error if these
     * conditions are not met.
     *
     * @param a - The first BigNumber to be verified.
     * @param b - The second BigNumber to be verified.
     *
     * @example
     * this.verify2(new BigNumber(10).toRed(this), new BigNumber(20).toRed(this));
     * this.verify2(new BigNumber(-10).toRed(this), new BigNumber(20).toRed(this)); //throws an Error
     * this.verify2(new BigNumber(10).toRed(this), new BigNumber(20)); //throws an Error
     */
    verify2(a, b) {
      this.assert((a.negative | b.negative) === 0, "red works only with positives");
      this.assert(a.red != null && a.red === b.red, "red works only with red numbers");
    }
    /**
     * Performs an in-place reduction of the given BigNumber by the modulus of the reduction context, 'm'.
     *
     * @method imod
     *
     * @param a - BigNumber to be reduced.
     *
     * @returns Returns the reduced result.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.imod(new BigNumber(19)); // Returns 5
     */
    imod(a) {
      if (this.prime != null)
        return this.prime.ireduce(a).forceRed(this);
      BigNumber.move(a, a.umod(this.m).forceRed(this));
      return a;
    }
    /**
     * Negates a BigNumber in the context of the modulus.
     *
     * @method neg
     *
     * @param a - BigNumber to negate.
     *
     * @returns Returns the negation of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.neg(new BigNumber(3)); // Returns 4
     */
    neg(a) {
      if (a.isZero()) {
        return a.clone();
      }
      return this.m.sub(a).forceRed(this);
    }
    /**
     * Performs the addition operation on two BigNumbers in the reduction context.
     *
     * @method add
     *
     * @param a - First BigNumber to add.
     * @param b - Second BigNumber to add.
     *
     * @returns Returns the result of 'a + b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * context.add(new BigNumber(2), new BigNumber(4)); // Returns 1
     */
    add(a, b) {
      this.verify2(a, b);
      const res = a.clone();
      res.iadd(b);
      res.isub(this.m);
      if (res.isNeg()) {
        res.iadd(this.m);
      }
      return res;
    }
    /**
     * Performs an in-place addition operation on two BigNumbers in the reduction context
     * in order to avoid creating a new BigNumber, it modifies the first one with the result.
     *
     * @method iadd
     *
     * @param a - First BigNumber to add.
     * @param b - Second BigNumber to add.
     *
     * @returns Returns the modified 'a' after addition with 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * const a = new BigNumber(2);
     * context.iadd(a, new BigNumber(4)); // Modifies 'a' to be 1
     */
    iadd(a, b) {
      this.verify2(a, b);
      a.iadd(b);
      a.isub(this.m);
      if (a.isNeg()) {
        a.iadd(this.m);
      }
      return a;
    }
    /**
     * Subtracts one BigNumber from another BigNumber in the reduction context.
     *
     * @method sub
     *
     * @param a - BigNumber to be subtracted from.
     * @param b - BigNumber to subtract.
     *
     * @returns Returns the result of 'a - b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.sub(new BigNumber(3), new BigNumber(2)); // Returns 1
     */
    sub(a, b) {
      this.verify2(a, b);
      const res = a.sub(b);
      if (res.cmpn(0) < 0) {
        res.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Performs in-place subtraction of one BigNumber from another in the reduction context,
     * it modifies the first BigNumber with the result.
     *
     * @method isub
     *
     * @param a - BigNumber to be subtracted from.
     * @param b - BigNumber to subtract.
     *
     * @returns Returns the modified 'a' after subtraction of 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * const a = new BigNumber(4);
     * context.isub(a, new BigNumber(2)); // Modifies 'a' to be 2
     */
    isub(a, b) {
      this.verify2(a, b);
      const res = a.isub(b);
      if (res.cmpn(0) < 0) {
        res.iadd(this.m);
      }
      return res;
    }
    /**
     * Performs bitwise shift left operation on a BigNumber in the reduction context.
     *
     * @method shl
     *
     * @param a - BigNumber to perform shift on.
     * @param num - The number of positions to shift.
     *
     * @returns Returns the result of shifting 'a' left by 'num' positions in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(32));
     * context.shl(new BigNumber(4), 2); // Returns 16
     */
    shl(a, num) {
      this.verify1(a);
      return this.imod(a.ushln(num));
    }
    /**
     * Performs in-place multiplication of two BigNumbers in the reduction context,
     * modifying the first BigNumber with the result.
     *
     * @method imul
     *
     * @param a - First BigNumber to multiply.
     * @param b - Second BigNumber to multiply.
     *
     * @returns Returns the modified 'a' after multiplication with 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = new BigNumber(3);
     * context.imul(a, new BigNumber(2)); // Modifies 'a' to be 6
     */
    imul(a, b) {
      this.verify2(a, b);
      return this.imod(a.imul(b));
    }
    /**
     * Multiplies two BigNumbers in the reduction context.
     *
     * @method mul
     *
     * @param a - First BigNumber to multiply.
     * @param b - Second BigNumber to multiply.
     *
     * @returns Returns the result of 'a * b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.mul(new BigNumber(3), new BigNumber(2)); // Returns 6
     */
    mul(a, b) {
      this.verify2(a, b);
      return this.imod(a.mul(b));
    }
    /**
     * Calculates the square of a BigNumber in the reduction context,
     * modifying the original BigNumber with the result.
     *
     * @method isqr
     *
     * @param a - BigNumber to be squared.
     *
     * @returns Returns the squared 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = new BigNumber(3);
     * context.isqr(a); // Modifies 'a' to be 2 (9 % 7 = 2)
     */
    isqr(a) {
      return this.imul(a, a.clone());
    }
    /**
     * Calculates the square of a BigNumber in the reduction context.
     *
     * @method sqr
     *
     * @param a - BigNumber to be squared.
     *
     * @returns Returns the result of 'a^2' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.sqr(new BigNumber(3)); // Returns 2 (9 % 7 = 2)
     */
    sqr(a) {
      return this.mul(a, a);
    }
    /**
     * Calculates the square root of a BigNumber in the reduction context.
     *
     * @method sqrt
     *
     * @param a - The BigNumber to calculate the square root of.
     *
     * @returns Returns the square root of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(9));
     * context.sqrt(new BigNumber(4)); // Returns 2
     */
    sqrt(a) {
      if (a.isZero())
        return a.clone();
      const mod3 = this.m.andln(3);
      this.assert(mod3 % 2 === 1);
      if (mod3 === 3) {
        const pow = this.m.add(new BigNumber(1)).iushrn(2);
        return this.pow(a, pow);
      }
      const q = this.m.subn(1);
      let s2 = 0;
      while (!q.isZero() && q.andln(1) === 0) {
        s2++;
        q.iushrn(1);
      }
      this.assert(!q.isZero());
      const one = new BigNumber(1).toRed(this);
      const nOne = one.redNeg();
      const lpow = this.m.subn(1).iushrn(1);
      const zl = this.m.bitLength();
      const z = new BigNumber(2 * zl * zl).toRed(this);
      while (this.pow(z, lpow).cmp(nOne) !== 0) {
        z.redIAdd(nOne);
      }
      let c = this.pow(z, q);
      let r2 = this.pow(a, q.addn(1).iushrn(1));
      let t = this.pow(a, q);
      let m = s2;
      while (t.cmp(one) !== 0) {
        let tmp = t;
        let i = 0;
        for (; tmp.cmp(one) !== 0; i++) {
          tmp = tmp.redSqr();
        }
        this.assert(i < m);
        const b = this.pow(c, new BigNumber(1).iushln(m - i - 1));
        r2 = r2.redMul(b);
        c = b.redSqr();
        t = t.redMul(c);
        m = i;
      }
      return r2;
    }
    /**
     * Calculates the multiplicative inverse of a BigNumber in the reduction context.
     *
     * @method invm
     *
     * @param a - The BigNumber to find the multiplicative inverse of.
     *
     * @returns Returns the multiplicative inverse of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(11));
     * context.invm(new BigNumber(3)); // Returns 4 (3*4 mod 11 = 1)
     */
    invm(a) {
      const inv = a._invmp(this.m);
      if (inv.negative !== 0) {
        inv.negative = 0;
        return this.imod(inv).redNeg();
      } else {
        return this.imod(inv);
      }
    }
    /**
     * Raises a BigNumber to a power in the reduction context.
     *
     * @method pow
     *
     * @param a - The BigNumber to be raised to a power.
     * @param num - The power to raise the BigNumber to.
     *
     * @returns Returns the result of 'a' raised to the power of 'num' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.pow(new BigNumber(3), new BigNumber(2)); // Returns 2 (3^2 % 7)
     */
    pow(a, num) {
      this.verify1(a);
      if (num.isZero())
        return new BigNumber(1).toRed(this);
      let result = new BigNumber(1).toRed(this);
      const base = a.clone();
      const bits = num.bitLength();
      for (let i = bits - 1; i >= 0; i--) {
        result = this.sqr(result);
        if (num.testn(i)) {
          result = this.mul(result, base);
        }
      }
      return result;
    }
    /**
     * Converts a BigNumber to its equivalent in the reduction context.
     *
     * @method convertTo
     *
     * @param num - The BigNumber to convert to the reduction context.
     *
     * @returns Returns the converted BigNumber compatible with the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.convertTo(new BigNumber(8)); // Returns 1 (8 % 7)
     */
    convertTo(num) {
      const r2 = num.umod(this.m);
      return r2 === num ? r2.clone() : r2;
    }
    /**
     * Converts a BigNumber from reduction context to its regular form.
     *
     * @method convertFrom
     *
     * @param num - The BigNumber to convert from the reduction context.
     *
     * @returns Returns the converted BigNumber in its regular form.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = context.convertTo(new BigNumber(8)); // 'a' is now 1 in the reduction context
     * context.convertFrom(a); // Returns 1
     */
    convertFrom(num) {
      const res = num.clone();
      res.red = null;
      return res;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/MontgomoryMethod.js
  var MontgomoryMethod = class extends ReductionContext {
    /**
     * @constructor
     * @param m - The modulus to be used for the Montgomery method reductions.
     */
    constructor(m) {
      super(m);
      __publicField(this, "shift");
      __publicField(this, "r");
      __publicField(this, "r2");
      __publicField(this, "rinv");
      __publicField(this, "minv");
      this.shift = this.m.bitLength();
      if (this.shift % 26 !== 0) {
        this.shift += 26 - this.shift % 26;
      }
      this.r = new BigNumber(1).iushln(this.shift);
      this.r2 = this.imod(this.r.sqr());
      this.rinv = this.r._invmp(this.m);
      this.minv = this.rinv.mul(this.r).isubn(1).div(this.m);
      this.minv = this.minv.umod(this.r);
      this.minv = this.r.sub(this.minv);
    }
    /**
     * Converts a number into the Montgomery domain.
     *
     * @method convertTo
     * @param num - The number to be converted into the Montgomery domain.
     * @returns The result of the conversion into the Montgomery domain.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const convertedNum = montMethod.convertTo(num);
     */
    convertTo(num) {
      return this.imod(num.ushln(this.shift));
    }
    /**
     * Converts a number from the Montgomery domain back to the original domain.
     *
     * @method convertFrom
     * @param num - The number to be converted from the Montgomery domain.
     * @returns The result of the conversion from the Montgomery domain.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const convertedNum = montMethod.convertFrom(num);
     */
    convertFrom(num) {
      const r2 = this.imod(num.mul(this.rinv));
      r2.red = null;
      return r2;
    }
    /**
     * Performs an in-place multiplication of two numbers in the Montgomery domain.
     *
     * @method imul
     * @param a - The first number to multiply.
     * @param b - The second number to multiply.
     * @returns The result of the in-place multiplication.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const product = montMethod.imul(a, b);
     */
    imul(a, b) {
      if (a.isZero() || b.isZero()) {
        a.words[0] = 0;
        a.length = 1;
        return a;
      }
      const t = a.imul(b);
      const c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
      const u = t.isub(c).iushrn(this.shift);
      let res = u;
      if (u.cmp(this.m) >= 0) {
        res = u.isub(this.m);
      } else if (u.cmpn(0) < 0) {
        res = u.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Performs the multiplication of two numbers in the Montgomery domain.
     *
     * @method mul
     * @param a - The first number to multiply.
     * @param b - The second number to multiply.
     * @returns The result of the multiplication.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const product = montMethod.mul(a, b);
     */
    mul(a, b) {
      if (a.isZero() || b.isZero())
        return new BigNumber(0).forceRed(this);
      const t = a.mul(b);
      const c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
      const u = t.isub(c).iushrn(this.shift);
      let res = u;
      if (u.cmp(this.m) >= 0) {
        res = u.isub(this.m);
      } else if (u.cmpn(0) < 0) {
        res = u.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Calculates the modular multiplicative inverse of a number in the Montgomery domain.
     *
     * @method invm
     * @param a - The number to compute the modular multiplicative inverse of.
     * @returns The modular multiplicative inverse of 'a'.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const inverse = montMethod.invm(a);
     */
    invm(a) {
      const res = this.imod(a._invmp(this.m).mul(this.r2));
      return res.forceRed(this);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/BasePoint.js
  var BasePoint = class {
    constructor(type) {
      __publicField(this, "curve");
      __publicField(this, "type");
      __publicField(this, "precomputed");
      this.curve = new Curve();
      this.type = type;
      this.precomputed = null;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/JacobianPoint.js
  var JacobianPoint = class _JacobianPoint extends BasePoint {
    /**
     * Constructs a new `JacobianPoint` instance.
     *
     * @param x - If `null`, the x-coordinate will default to the curve's defined 'one' constant.
     * If `x` is not a BigNumber, `x` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @param y - If `null`, the y-coordinate will default to the curve's defined 'one' constant.
     * If `y` is not a BigNumber, `y` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @param z - If `null`, the z-coordinate will default to 0.
     * If `z` is not a BigNumber, `z` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @example
     * const pointJ1 = new JacobianPoint(null, null, null); // creates point at infinity
     * const pointJ2 = new JacobianPoint('3', '4', '1'); // creates point (3, 4, 1)
     */
    constructor(x, y, z) {
      super("jacobian");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "z");
      __publicField(this, "zOne");
      if (x === null && y === null && z === null) {
        this.x = this.curve.one;
        this.y = this.curve.one;
        this.z = new BigNumber(0);
      } else {
        if (!BigNumber.isBN(x)) {
          x = new BigNumber(x, 16);
        }
        this.x = x;
        if (!BigNumber.isBN(y)) {
          y = new BigNumber(y, 16);
        }
        this.y = y;
        if (!BigNumber.isBN(z)) {
          z = new BigNumber(z, 16);
        }
        this.z = z;
      }
      if (this.x.red == null) {
        this.x = this.x.toRed(this.curve.red);
      }
      if (this.y.red == null) {
        this.y = this.y.toRed(this.curve.red);
      }
      if (this.z.red == null) {
        this.z = this.z.toRed(this.curve.red);
      }
      this.zOne = this.z === this.curve.one;
      if (this.isInfinity()) {
        this.x = this.curve.one;
        this.y = this.curve.one;
        this.z = new BigNumber(0).toRed(this.curve.red);
        this.zOne = false;
      }
    }
    /**
     * Converts the `JacobianPoint` object instance to standard affine `Point` format and returns `Point` type.
     *
     * @returns The `Point`(affine) object representing the same point as the original `JacobianPoint`.
     *
     * If the initial `JacobianPoint` represents point at infinity, an instance of `Point` at infinity is returned.
     *
     * @example
     * const pointJ = new JacobianPoint('3', '4', '1');
     * const pointP = pointJ.toP();  // The point in affine coordinates.
     */
    toP() {
      if (this.isInfinity()) {
        return new Point(null, null);
      }
      const zinv = this.z.redInvm();
      const zinv2 = zinv.redSqr();
      const ax = this.x.redMul(zinv2);
      const ay = this.y.redMul(zinv2).redMul(zinv);
      return new Point(ax, ay);
    }
    /**
     * Negation operation. It returns the additive inverse of the Jacobian point.
     *
     * @method neg
     * @returns Returns a new Jacobian point as the result of the negation.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.neg()
     */
    neg() {
      return new _JacobianPoint(this.x, this.y.redNeg(), this.z);
    }
    /**
     * Addition operation in the Jacobian coordinates. It takes a Jacobian point as an argument
     * and returns a new Jacobian point as a result of the addition. In the special cases,
     * when either one of the points is the point at infinity, it will return the other point.
     *
     * @method add
     * @param p - The Jacobian point to be added.
     * @returns Returns a new Jacobian point as the result of the addition.
     *
     * @example
     * const p1 = new JacobianPoint(x1, y1, z1)
     * const p2 = new JacobianPoint(x2, y2, z2)
     * const result = p1.add(p2)
     */
    add(p) {
      if (this.isInfinity()) {
        return p;
      }
      if (p.isInfinity()) {
        return this;
      }
      const pz2 = p.z.redSqr();
      const z2 = this.z.redSqr();
      const u1 = this.x.redMul(pz2);
      const u2 = p.x.redMul(z2);
      const s1 = this.y.redMul(pz2.redMul(p.z));
      const s2 = p.y.redMul(z2.redMul(this.z));
      const h = u1.redSub(u2);
      const r2 = s1.redSub(s2);
      if (h.cmpn(0) === 0) {
        if (r2.cmpn(0) !== 0) {
          return new _JacobianPoint(null, null, null);
        } else {
          return this.dbl();
        }
      }
      const h2 = h.redSqr();
      const h3 = h2.redMul(h);
      const v = u1.redMul(h2);
      const nx = r2.redSqr().redIAdd(h3).redISub(v).redISub(v);
      const ny = r2.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
      const nz = this.z.redMul(p.z).redMul(h);
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Mixed addition operation. This function combines the standard point addition with
     * the transformation from the affine to Jacobian coordinates. It first converts
     * the affine point to Jacobian, and then preforms the addition.
     *
     * @method mixedAdd
     * @param p - The affine point to be added.
     * @returns Returns the result of the mixed addition as a new Jacobian point.
     *
     * @example
     * const jp = new JacobianPoint(x1, y1, z1)
     * const ap = new Point(x2, y2)
     * const result = jp.mixedAdd(ap)
     */
    mixedAdd(p) {
      if (this.isInfinity()) {
        return p.toJ();
      }
      if (p.isInfinity()) {
        return this;
      }
      if (p.x === null || p.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const z2 = this.z.redSqr();
      const u1 = this.x;
      const u2 = p.x.redMul(z2);
      const s1 = this.y;
      const s2 = p.y.redMul(z2).redMul(this.z);
      const h = u1.redSub(u2);
      const r2 = s1.redSub(s2);
      if (h.cmpn(0) === 0) {
        if (r2.cmpn(0) !== 0) {
          return new _JacobianPoint(null, null, null);
        } else {
          return this.dbl();
        }
      }
      const h2 = h.redSqr();
      const h3 = h2.redMul(h);
      const v = u1.redMul(h2);
      const nx = r2.redSqr().redIAdd(h3).redISub(v).redISub(v);
      const ny = r2.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
      const nz = this.z.redMul(h);
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Multiple doubling operation. It doubles the Jacobian point as many times as the pow parameter specifies. If pow is 0 or the point is the point at infinity, it will return the point itself.
     *
     * @method dblp
     * @param pow - The number of times the point should be doubled.
     * @returns Returns a new Jacobian point as the result of multiple doublings.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.dblp(3)
     */
    dblp(pow) {
      if (pow === 0) {
        return this;
      }
      if (this.isInfinity()) {
        return this;
      }
      if (typeof pow === "undefined") {
        return this.dbl();
      }
      let r2 = this;
      for (let i = 0; i < pow; i++) {
        r2 = r2.dbl();
      }
      return r2;
    }
    /**
     * Point doubling operation in the Jacobian coordinates. A special case is when the point is the point at infinity, in this case, this function will return the point itself.
     *
     * @method dbl
     * @returns Returns a new Jacobian point as the result of the doubling.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.dbl()
     */
    dbl() {
      if (this.isInfinity()) {
        return this;
      }
      let nx;
      let ny;
      let nz;
      if (this.zOne) {
        const xx = this.x.redSqr();
        const yy = this.y.redSqr();
        const yyyy = yy.redSqr();
        let s2 = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
        s2 = s2.redIAdd(s2);
        const m = xx.redAdd(xx).redIAdd(xx);
        const t = m.redSqr().redISub(s2).redISub(s2);
        let yyyy8 = yyyy.redIAdd(yyyy);
        yyyy8 = yyyy8.redIAdd(yyyy8);
        yyyy8 = yyyy8.redIAdd(yyyy8);
        nx = t;
        ny = m.redMul(s2.redISub(t)).redISub(yyyy8);
        nz = this.y.redAdd(this.y);
      } else {
        const a = this.x.redSqr();
        const b = this.y.redSqr();
        const c = b.redSqr();
        let d = this.x.redAdd(b).redSqr().redISub(a).redISub(c);
        d = d.redIAdd(d);
        const e = a.redAdd(a).redIAdd(a);
        const f2 = e.redSqr();
        let c8 = c.redIAdd(c);
        c8 = c8.redIAdd(c8);
        c8 = c8.redIAdd(c8);
        nx = f2.redISub(d).redISub(d);
        ny = e.redMul(d.redISub(nx)).redISub(c8);
        nz = this.y.redMul(this.z);
        nz = nz.redIAdd(nz);
      }
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Equality check operation. It checks whether the affine or Jacobian point is equal to this Jacobian point.
     *
     * @method eq
     * @param p - The affine or Jacobian point to compare with.
     * @returns Returns true if the points are equal, otherwise returns false.
     *
     * @example
     * const jp1 = new JacobianPoint(x1, y1, z1)
     * const jp2 = new JacobianPoint(x2, y2, z2)
     * const areEqual = jp1.eq(jp2)
     */
    eq(p) {
      if (p.type === "affine") {
        return this.eq(p.toJ());
      }
      if (this === p) {
        return true;
      }
      p = p;
      if (this.isInfinity() && p.isInfinity()) {
        return true;
      }
      if (this.isInfinity() !== p.isInfinity()) {
        return false;
      }
      const z2 = this.z.redSqr();
      const pz2 = p.z.redSqr();
      if (this.x.redMul(pz2).redISub(p.x.redMul(z2)).cmpn(0) !== 0) {
        return false;
      }
      const z3 = z2.redMul(this.z);
      const pz3 = pz2.redMul(p.z);
      return this.y.redMul(pz3).redISub(p.y.redMul(z3)).cmpn(0) === 0;
    }
    /**
     * Equality check operation in relation to an x coordinate of a point in projective coordinates.
     * It checks whether the x coordinate of the Jacobian point is equal to the provided x coordinate
     * of a point in projective coordinates.
     *
     * @method eqXToP
     * @param x - The x coordinate of a point in projective coordinates.
     * @returns Returns true if the x coordinates are equal, otherwise returns false.
     *
     * @example
     * const jp = new JacobianPoint(x1, y1, z1)
     * const isXEqual = jp.eqXToP(x2)
     */
    eqXToP(x) {
      const zs = this.z.redSqr();
      const rx = x.toRed(this.curve?.red).redMul(zs);
      if (this.x.cmp(rx) === 0) {
        return true;
      }
      const xc = x.clone();
      if (this.curve === null || this.curve.redN == null) {
        throw new Error("Curve or redN is not initialized.");
      }
      const t = this.curve.redN.redMul(zs);
      while (xc.cmp(this.curve.p) < 0) {
        xc.iadd(this.curve.n);
        if (xc.cmp(this.curve.p) >= 0) {
          return false;
        }
        rx.redIAdd(t);
        if (this.x.cmp(rx) === 0) {
          return true;
        }
      }
      return false;
    }
    /**
     * Returns the string representation of the JacobianPoint instance.
     * @method inspect
     * @returns Returns the string description of the JacobianPoint. If the JacobianPoint represents a point at infinity, the return value of this function is '<EC JPoint Infinity>'. For a normal point, it returns the string description format as '<EC JPoint x: x-coordinate y: y-coordinate z: z-coordinate>'.
     *
     * @example
     * const point = new JacobianPoint('5', '6', '1');
     * console.log(point.inspect()); // Output: '<EC JPoint x: 5 y: 6 z: 1>'
     */
    inspect() {
      if (this.isInfinity()) {
        return "<EC JPoint Infinity>";
      }
      return "<EC JPoint x: " + this.x.toString(16, 2) + " y: " + this.y.toString(16, 2) + " z: " + this.z.toString(16, 2) + ">";
    }
    /**
     * Checks whether the JacobianPoint instance represents a point at infinity.
     * @method isInfinity
     * @returns Returns true if the JacobianPoint's z-coordinate equals to zero (which represents the point at infinity in Jacobian coordinates). Returns false otherwise.
     *
     * @example
     * const point = new JacobianPoint('5', '6', '0');
     * console.log(point.isInfinity()); // Output: true
     */
    isInfinity() {
      return this.z.cmpn(0) === 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Hash.js
  var Hash_exports = {};
  __export(Hash_exports, {
    RIPEMD160: () => RIPEMD160,
    SHA1: () => SHA1,
    SHA1HMAC: () => SHA1HMAC,
    SHA256: () => SHA256,
    SHA256HMAC: () => SHA256HMAC,
    SHA512: () => SHA512,
    SHA512HMAC: () => SHA512HMAC,
    hash160: () => hash160,
    hash256: () => hash256,
    htonl: () => htonl,
    pbkdf2: () => pbkdf2,
    realHtonl: () => realHtonl,
    ripemd160: () => ripemd160,
    sha1: () => sha1,
    sha256: () => sha256,
    sha256hmac: () => sha256hmac,
    sha512: () => sha512,
    sha512hmac: () => sha512hmac,
    swapBytes32: () => swapBytes32,
    toArray: () => toArray
  });

  // node_modules/@bsv/sdk/dist/esm/src/primitives/hex.js
  var PURE_HEX_REGEX = /^[0-9a-fA-F]*$/;
  function assertValidHex(msg) {
    if (typeof msg !== "string") {
      throw new TypeError("Invalid hex string");
    }
    if (msg.length === 0)
      return;
    if (!PURE_HEX_REGEX.test(msg)) {
      throw new Error("Invalid hex string");
    }
  }
  function normalizeHex(msg) {
    assertValidHex(msg);
    if (msg.length === 0)
      return "";
    let normalized = msg.toLowerCase();
    if (normalized.length % 2 !== 0) {
      normalized = "0" + normalized;
    }
    return normalized;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Hash.js
  var assert = (expression, message = "Hash assertion failed") => {
    if (!expression) {
      throw new Error(message);
    }
  };
  var BaseHash = class {
    constructor(blockSize, outSize, hmacStrength, padLength) {
      __publicField(this, "pending");
      __publicField(this, "pendingTotal");
      __publicField(this, "blockSize");
      __publicField(this, "outSize");
      __publicField(this, "endian");
      __publicField(this, "_delta8");
      __publicField(this, "_delta32");
      __publicField(this, "padLength");
      __publicField(this, "hmacStrength");
      this.pending = null;
      this.pendingTotal = 0;
      this.blockSize = blockSize;
      this.outSize = outSize;
      this.hmacStrength = hmacStrength;
      this.padLength = padLength / 8;
      this.endian = "big";
      this._delta8 = this.blockSize / 8;
      this._delta32 = this.blockSize / 32;
    }
    _update(msg, start) {
      throw new Error("Not implemented");
    }
    _digest() {
      throw new Error("Not implemented");
    }
    _digestHex() {
      throw new Error("Not implemented");
    }
    /**
     * Converts the input message into an array, pads it, and joins into 32bit blocks.
     * If there is enough data, it tries updating the hash computation.
     *
     * @method update
     * @param msg - The message segment to include in the hashing computation.
     * @param enc - The encoding of the message. If 'hex', the string will be treated as such, 'utf8' otherwise.
     *
     * @returns Returns the instance of the object for chaining.
     *
     * @example
     * sha256.update('Hello World', 'utf8');
     */
    update(msg, enc) {
      msg = toArray(msg, enc);
      if (this.pending == null) {
        this.pending = msg;
      } else {
        this.pending = this.pending.concat(msg);
      }
      this.pendingTotal += msg.length;
      if (this.pending.length >= this._delta8) {
        msg = this.pending;
        const r2 = msg.length % this._delta8;
        this.pending = msg.slice(msg.length - r2, msg.length);
        if (this.pending.length === 0) {
          this.pending = null;
        }
        msg = join32(msg, 0, msg.length - r2, this.endian);
        for (let i = 0; i < msg.length; i += this._delta32) {
          this._update(msg, i);
        }
      }
      return this;
    }
    /**
     * Finalizes the hash computation and returns the hash value/result.
     *
     * @method digest
     *
     * @returns Returns the final hash value.
     *
     * @example
     * const hash = sha256.digest();
     */
    digest() {
      this.update(this._pad());
      assert(this.pending === null);
      return this._digest();
    }
    /**
     * Finalizes the hash computation and returns the hash value/result as a hex string.
     *
     * @method digest
     *
     * @returns Returns the final hash value as a hex string.
     *
     * @example
     * const hash = sha256.digestHex();
     */
    digestHex() {
      this.update(this._pad());
      assert(this.pending === null);
      return this._digestHex();
    }
    /**
     * [Private Method] Used internally to prepare the padding for the final stage of the hash computation.
     *
     * @method _pad
     * @private
     *
     * @returns Returns an array denoting the padding.
     */
    _pad() {
      const len = this.pendingTotal;
      if (!Number.isSafeInteger(len) || len < 0) {
        throw new Error("Message too long for this hash function");
      }
      const bytes2 = this._delta8;
      const k = bytes2 - (len + this.padLength) % bytes2;
      const res = new Array(k + this.padLength);
      res[0] = 128;
      let i;
      for (i = 1; i < k; i++) {
        res[i] = 0;
      }
      const lengthBytes = this.padLength;
      const maxBits = 1n << BigInt(lengthBytes * 8);
      let totalBits = BigInt(len) * 8n;
      if (totalBits >= maxBits) {
        throw new Error("Message too long for this hash function");
      }
      if (this.endian === "big") {
        const lenArray = new Array(lengthBytes);
        for (let b = lengthBytes - 1; b >= 0; b--) {
          lenArray[b] = Number(totalBits & 0xffn);
          totalBits >>= 8n;
        }
        for (let b = 0; b < lengthBytes; b++) {
          res[i++] = lenArray[b];
        }
      } else {
        for (let b = 0; b < lengthBytes; b++) {
          res[i++] = Number(totalBits & 0xffn);
          totalBits >>= 8n;
        }
      }
      return res;
    }
  };
  function isSurrogatePair(msg, i) {
    if ((msg.charCodeAt(i) & 64512) !== 55296) {
      return false;
    }
    if (i < 0 || i + 1 >= msg.length) {
      return false;
    }
    return (msg.charCodeAt(i + 1) & 64512) === 56320;
  }
  function toArray(msg, enc) {
    if (Array.isArray(msg)) {
      return msg.slice();
    }
    if (!msg) {
      return [];
    }
    const res = [];
    if (typeof msg === "string") {
      if (enc !== "hex") {
        let p = 0;
        for (let i = 0; i < msg.length; i++) {
          let c = msg.charCodeAt(i);
          if (c < 128) {
            res[p++] = c;
          } else if (c < 2048) {
            res[p++] = c >> 6 | 192;
            res[p++] = c & 63 | 128;
          } else if (isSurrogatePair(msg, i)) {
            c = 65536 + ((c & 1023) << 10) + (msg.charCodeAt(++i) & 1023);
            res[p++] = c >> 18 | 240;
            res[p++] = c >> 12 & 63 | 128;
            res[p++] = c >> 6 & 63 | 128;
            res[p++] = c & 63 | 128;
          } else {
            res[p++] = c >> 12 | 224;
            res[p++] = c >> 6 & 63 | 128;
            res[p++] = c & 63 | 128;
          }
        }
      } else {
        assertValidHex(msg);
        msg = normalizeHex(msg);
        for (let i = 0; i < msg.length; i += 2) {
          res.push(parseInt(msg[i] + msg[i + 1], 16));
        }
      }
    } else {
      msg = msg;
      for (let i = 0; i < msg.length; i++) {
        res[i] = msg[i] | 0;
      }
    }
    return res;
  }
  function htonl(w) {
    return swapBytes32(w);
  }
  function toHex32(msg, endian) {
    let res = "";
    for (let i = 0; i < msg.length; i++) {
      let w = msg[i];
      if (endian === "little") {
        w = htonl(w);
      }
      res += zero8(w.toString(16));
    }
    return res;
  }
  function zero8(word) {
    if (word.length === 7) {
      return "0" + word;
    } else if (word.length === 6) {
      return "00" + word;
    } else if (word.length === 5) {
      return "000" + word;
    } else if (word.length === 4) {
      return "0000" + word;
    } else if (word.length === 3) {
      return "00000" + word;
    } else if (word.length === 2) {
      return "000000" + word;
    } else if (word.length === 1) {
      return "0000000" + word;
    } else {
      return word;
    }
  }
  function bytesToHex(data) {
    let res = "";
    for (const b of data)
      res += b.toString(16).padStart(2, "0");
    return res;
  }
  function join32(msg, start, end, endian) {
    const len = end - start;
    assert(len % 4 === 0);
    const res = new Array(len / 4);
    for (let i = 0, k = start; i < res.length; i++, k += 4) {
      let w;
      if (endian === "big") {
        w = msg[k] << 24 | msg[k + 1] << 16 | msg[k + 2] << 8 | msg[k + 3];
      } else {
        w = msg[k + 3] << 24 | msg[k + 2] << 16 | msg[k + 1] << 8 | msg[k];
      }
      res[i] = w >>> 0;
    }
    return res;
  }
  function split32(msg, endian) {
    const res = new Array(msg.length * 4);
    for (let i = 0, k = 0; i < msg.length; i++, k += 4) {
      const m = msg[i];
      if (endian === "big") {
        res[k] = m >>> 24;
        res[k + 1] = m >>> 16 & 255;
        res[k + 2] = m >>> 8 & 255;
        res[k + 3] = m & 255;
      } else {
        res[k + 3] = m >>> 24;
        res[k + 2] = m >>> 16 & 255;
        res[k + 1] = m >>> 8 & 255;
        res[k] = m & 255;
      }
    }
    return res;
  }
  function rotr32(w, b) {
    return w >>> b | w << 32 - b;
  }
  function rotl32(w, b) {
    return w << b | w >>> 32 - b;
  }
  function sum32(a, b) {
    return a + b >>> 0;
  }
  function SUM32_3(a, b, c) {
    return a + b + c >>> 0;
  }
  function SUM32_4(a, b, c, d) {
    return a + b + c + d >>> 0;
  }
  function SUM32_5(a, b, c, d, e) {
    return a + b + c + d + e >>> 0;
  }
  function FT_1(s2, x, y, z) {
    if (s2 === 0) {
      return ch32(x, y, z);
    }
    if (s2 === 1 || s2 === 3) {
      return p32(x, y, z);
    }
    if (s2 === 2) {
      return maj32(x, y, z);
    }
    return 0;
  }
  function ch32(x, y, z) {
    return x & y ^ ~x & z;
  }
  function maj32(x, y, z) {
    return x & y ^ x & z ^ y & z;
  }
  function p32(x, y, z) {
    return x ^ y ^ z;
  }
  function S0_256(x) {
    return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22);
  }
  function S1_256(x) {
    return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25);
  }
  function G0_256(x) {
    return rotr32(x, 7) ^ rotr32(x, 18) ^ x >>> 3;
  }
  function G1_256(x) {
    return rotr32(x, 17) ^ rotr32(x, 19) ^ x >>> 10;
  }
  var r = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    7,
    4,
    13,
    1,
    10,
    6,
    15,
    3,
    12,
    0,
    9,
    5,
    2,
    14,
    11,
    8,
    3,
    10,
    14,
    4,
    9,
    15,
    8,
    1,
    2,
    7,
    0,
    6,
    13,
    11,
    5,
    12,
    1,
    9,
    11,
    10,
    0,
    8,
    12,
    4,
    13,
    3,
    7,
    15,
    14,
    5,
    6,
    2,
    4,
    0,
    5,
    9,
    7,
    12,
    2,
    10,
    14,
    1,
    3,
    8,
    11,
    6,
    15,
    13
  ];
  var rh = [
    5,
    14,
    7,
    0,
    9,
    2,
    11,
    4,
    13,
    6,
    15,
    8,
    1,
    10,
    3,
    12,
    6,
    11,
    3,
    7,
    0,
    13,
    5,
    10,
    14,
    15,
    8,
    12,
    4,
    9,
    1,
    2,
    15,
    5,
    1,
    3,
    7,
    14,
    6,
    9,
    11,
    8,
    12,
    2,
    10,
    0,
    4,
    13,
    8,
    6,
    4,
    1,
    3,
    11,
    15,
    0,
    5,
    12,
    2,
    13,
    9,
    7,
    10,
    14,
    12,
    15,
    10,
    4,
    1,
    5,
    8,
    7,
    6,
    2,
    13,
    14,
    0,
    3,
    9,
    11
  ];
  var s = [
    11,
    14,
    15,
    12,
    5,
    8,
    7,
    9,
    11,
    13,
    14,
    15,
    6,
    7,
    9,
    8,
    7,
    6,
    8,
    13,
    11,
    9,
    7,
    15,
    7,
    12,
    15,
    9,
    11,
    7,
    13,
    12,
    11,
    13,
    6,
    7,
    14,
    9,
    13,
    15,
    14,
    8,
    13,
    6,
    5,
    12,
    7,
    5,
    11,
    12,
    14,
    15,
    14,
    15,
    9,
    8,
    9,
    14,
    5,
    6,
    8,
    6,
    5,
    12,
    9,
    15,
    5,
    11,
    6,
    8,
    13,
    12,
    5,
    12,
    13,
    14,
    11,
    8,
    5,
    6
  ];
  var sh = [
    8,
    9,
    9,
    11,
    13,
    15,
    15,
    5,
    7,
    7,
    8,
    11,
    14,
    14,
    12,
    6,
    9,
    13,
    15,
    7,
    12,
    8,
    9,
    11,
    7,
    7,
    12,
    7,
    6,
    15,
    13,
    11,
    9,
    7,
    15,
    11,
    8,
    6,
    6,
    14,
    12,
    13,
    5,
    14,
    13,
    13,
    7,
    5,
    15,
    5,
    8,
    11,
    14,
    14,
    6,
    14,
    6,
    9,
    12,
    9,
    12,
    5,
    15,
    8,
    8,
    5,
    12,
    9,
    12,
    5,
    14,
    6,
    8,
    13,
    6,
    5,
    15,
    13,
    11,
    11
  ];
  function f(j, x, y, z) {
    if (j <= 15) {
      return x ^ y ^ z;
    } else if (j <= 31) {
      return x & y | ~x & z;
    } else if (j <= 47) {
      return (x | ~y) ^ z;
    } else if (j <= 63) {
      return x & z | y & ~z;
    } else {
      return x ^ (y | ~z);
    }
  }
  function K(j) {
    if (j <= 15) {
      return 0;
    } else if (j <= 31) {
      return 1518500249;
    } else if (j <= 47) {
      return 1859775393;
    } else if (j <= 63) {
      return 2400959708;
    } else {
      return 2840853838;
    }
  }
  function Kh(j) {
    if (j <= 15) {
      return 1352829926;
    } else if (j <= 31) {
      return 1548603684;
    } else if (j <= 47) {
      return 1836072691;
    } else if (j <= 63) {
      return 2053994217;
    } else {
      return 0;
    }
  }
  var RIPEMD160 = class extends BaseHash {
    constructor() {
      super(512, 160, 192, 64);
      __publicField(this, "h");
      this.endian = "little";
      this.h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
      this.endian = "little";
    }
    _update(msg, start) {
      let A2 = this.h[0];
      let B2 = this.h[1];
      let C = this.h[2];
      let D = this.h[3];
      let E = this.h[4];
      let Ah = A2;
      let Bh = B2;
      let Ch = C;
      let Dh = D;
      let Eh = E;
      let T;
      for (let j = 0; j < 80; j++) {
        T = sum32(rotl32(SUM32_4(A2, f(j, B2, C, D), msg[r[j] + start], K(j)), s[j]), E);
        A2 = E;
        E = D;
        D = rotl32(C, 10);
        C = B2;
        B2 = T;
        T = sum32(rotl32(SUM32_4(Ah, f(79 - j, Bh, Ch, Dh), msg[rh[j] + start], Kh(j)), sh[j]), Eh);
        Ah = Eh;
        Eh = Dh;
        Dh = rotl32(Ch, 10);
        Ch = Bh;
        Bh = T;
      }
      T = SUM32_3(this.h[1], C, Dh);
      this.h[1] = SUM32_3(this.h[2], D, Eh);
      this.h[2] = SUM32_3(this.h[3], E, Ah);
      this.h[3] = SUM32_3(this.h[4], A2, Bh);
      this.h[4] = SUM32_3(this.h[0], B2, Ch);
      this.h[0] = T;
    }
    _digest() {
      return split32(this.h, "little");
    }
    _digestHex() {
      return toHex32(this.h, "little");
    }
  };
  var SHA256 = class {
    constructor() {
      __publicField(this, "h");
      this.h = new FastSHA256();
    }
    update(msg, enc) {
      const data = msg instanceof Uint8Array ? msg : Uint8Array.from(toArray(msg, enc));
      this.h.update(data);
      return this;
    }
    digest() {
      return Array.from(this.h.digest());
    }
    digestHex() {
      return bytesToHex(this.h.digest());
    }
  };
  var SHA1 = class extends BaseHash {
    constructor() {
      super(512, 160, 80, 64);
      __publicField(this, "h");
      __publicField(this, "W");
      __publicField(this, "k");
      this.k = [1518500249, 1859775393, 2400959708, 3395469782];
      this.h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
      this.W = new Array(80);
    }
    _update(msg, start) {
      const W = this.W;
      if (start === void 0) {
        start = 0;
      }
      let i;
      for (i = 0; i < 16; i++) {
        W[i] = msg[start + i];
      }
      for (; i < W.length; i++) {
        W[i] = rotl32(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
      }
      let a = this.h[0];
      let b = this.h[1];
      let c = this.h[2];
      let d = this.h[3];
      let e = this.h[4];
      for (i = 0; i < W.length; i++) {
        const s2 = ~~(i / 20);
        const t = SUM32_5(rotl32(a, 5), FT_1(s2, b, c, d), e, W[i], this.k[s2]);
        e = d;
        d = c;
        c = rotl32(b, 30);
        b = a;
        a = t;
      }
      this.h[0] = sum32(this.h[0], a);
      this.h[1] = sum32(this.h[1], b);
      this.h[2] = sum32(this.h[2], c);
      this.h[3] = sum32(this.h[3], d);
      this.h[4] = sum32(this.h[4], e);
    }
    _digest() {
      return split32(this.h, "big");
    }
    _digestHex() {
      return toHex32(this.h, "big");
    }
  };
  var SHA512 = class {
    constructor() {
      __publicField(this, "h");
      this.h = new FastSHA512();
    }
    update(msg, enc) {
      const data = Uint8Array.from(toArray(msg, enc));
      this.h.update(data);
      return this;
    }
    digest() {
      return Array.from(this.h.digest());
    }
    digestHex() {
      return bytesToHex(this.h.digest());
    }
  };
  var SHA256HMAC = class {
    /**
     * The constructor for the `SHA256HMAC` class.
     *
     * It initializes the `SHA256HMAC` object and sets up the inner and outer padded keys.
     * If the key size is larger than the blockSize, it is digested using SHA-256.
     * If the key size is less than the blockSize, it is padded with zeroes.
     *
     * @constructor
     * @param key - The key to use to create the HMAC. Can be a number array or a string in hexadecimal format.
     *
     * @example
     * const myHMAC = new SHA256HMAC('deadbeef');
     */
    constructor(key) {
      __publicField(this, "h");
      __publicField(this, "blockSize", 64);
      __publicField(this, "outSize", 32);
      const k = key instanceof Uint8Array ? key : Uint8Array.from(toArray(key, typeof key === "string" ? "hex" : void 0));
      this.h = new HMAC(sha256Fast, k);
    }
    /**
     * Updates the `SHA256HMAC` object with part of the message to be hashed.
     *
     * @method update
     * @param msg - Part of the message to hash. Can be a number array or a string.
     * @param enc - If 'hex', then the input is encoded as hexadecimal. If undefined or not 'hex', then no encoding is performed.
     * @returns Returns the instance of `SHA256HMAC` for chaining calls.
     *
     * @example
     * myHMAC.update('deadbeef', 'hex');
     */
    update(msg, enc) {
      const data = msg instanceof Uint8Array ? msg : Uint8Array.from(toArray(msg, enc));
      this.h.update(data);
      return this;
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash.
     *
     * @method digest
     * @returns Returns the digest of the hashed data. Can be a number array or a string.
     *
     * @example
     * let hashedMessage = myHMAC.digest();
     */
    digest() {
      return Array.from(this.h.digest());
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash as a hex string.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a hex string
     *
     * @example
     * let hashedMessage = myHMAC.digestHex();
     */
    digestHex() {
      return bytesToHex(this.h.digest());
    }
  };
  var SHA1HMAC = class {
    constructor(key) {
      __publicField(this, "inner");
      __publicField(this, "outer");
      __publicField(this, "blockSize", 64);
      key = toArray(key, "hex");
      if (key.length > this.blockSize) {
        key = new SHA1().update(key).digest();
      }
      let i;
      for (i = key.length; i < this.blockSize; i++) {
        key.push(0);
      }
      for (i = 0; i < key.length; i++) {
        key[i] ^= 54;
      }
      this.inner = new SHA1().update(key);
      for (i = 0; i < key.length; i++) {
        key[i] ^= 106;
      }
      this.outer = new SHA1().update(key);
    }
    update(msg, enc) {
      this.inner.update(msg, enc);
      return this;
    }
    digest() {
      this.outer.update(this.inner.digest());
      return this.outer.digest();
    }
    digestHex() {
      this.outer.update(this.inner.digest());
      return this.outer.digestHex();
    }
  };
  var SHA512HMAC = class {
    /**
     * The constructor for the `SHA512HMAC` class.
     *
     * It initializes the `SHA512HMAC` object and sets up the inner and outer padded keys.
     * If the key size is larger than the blockSize, it is digested using SHA-512.
     * If the key size is less than the blockSize, it is padded with zeroes.
     *
     * @constructor
     * @param key - The key to use to create the HMAC. Can be a number array or a string in hexadecimal format.
     *
     * @example
     * const myHMAC = new SHA512HMAC('deadbeef');
     */
    constructor(key) {
      __publicField(this, "h");
      __publicField(this, "blockSize", 128);
      __publicField(this, "outSize", 32);
      const k = key instanceof Uint8Array ? key : Uint8Array.from(toArray(key, typeof key === "string" ? "hex" : void 0));
      this.h = new HMAC(sha512Fast, k);
    }
    /**
     * Updates the `SHA512HMAC` object with part of the message to be hashed.
     *
     * @method update
     * @param msg - Part of the message to hash. Can be a number array or a string.
     * @param enc - If 'hex', then the input is encoded as hexadecimal. If undefined or not 'hex', then no encoding is performed.
     * @returns Returns the instance of `SHA512HMAC` for chaining calls.
     *
     * @example
     * myHMAC.update('deadbeef', 'hex');
     */
    update(msg, enc) {
      const data = msg instanceof Uint8Array ? msg : Uint8Array.from(toArray(msg, enc));
      this.h.update(data);
      return this;
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a number array.
     *
     * @example
     * let hashedMessage = myHMAC.digest();
     */
    digest() {
      return Array.from(this.h.digest());
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash as a hex string.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a hex string
     *
     * @example
     * let hashedMessage = myHMAC.digestHex();
     */
    digestHex() {
      return bytesToHex(this.h.digest());
    }
  };
  var ripemd160 = (msg, enc) => {
    return new RIPEMD160().update(msg, enc).digest();
  };
  var sha1 = (msg, enc) => {
    return new SHA1().update(msg, enc).digest();
  };
  var sha256 = (msg, enc) => {
    return new SHA256().update(msg, enc).digest();
  };
  var sha512 = (msg, enc) => {
    return new SHA512().update(msg, enc).digest();
  };
  var hash256 = (msg, enc) => {
    const first = new SHA256().update(msg, enc).digest();
    return new SHA256().update(first).digest();
  };
  var hash160 = (msg, enc) => {
    const first = new SHA256().update(msg, enc).digest();
    return new RIPEMD160().update(first).digest();
  };
  var sha256hmac = (key, msg, enc) => {
    return new SHA256HMAC(key).update(msg, enc).digest();
  };
  var sha512hmac = (key, msg, enc) => {
    return new SHA512HMAC(key).update(msg, enc).digest();
  };
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new Error(`positive integer expected, got ${n}`);
    }
  }
  function abytes(b, ...lengths) {
    if (!isBytes(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length)) {
      const lens = lengths.join(",");
      throw new Error(`Uint8Array expected of length ${lens}, got length=${b.length}`);
    }
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function") {
      throw new Error("Hash should be wrapped by utils.createHasher");
    }
    anumber(h.outputLen);
    anumber(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed === true)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished === true) {
      throw new Error("Hash#digest() has already been called");
    }
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error(`digestInto() expects output buffer of length at least ${min}`);
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++)
      arrays[i].fill(0);
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function kdfInputToBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  var Hash = class {
  };
  function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }
  var U32_MASK64 = BigInt(2 ** 32 - 1);
  var _32n = BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    const Ah = new Uint32Array(len);
    const Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      Ah[i] = h;
      Al[i] = l;
    }
    return [Ah, Al];
  }
  var shrSH = (h, _l, s2) => h >>> s2;
  var shrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
  var rotrSH = (h, l, s2) => h >>> s2 | l << 32 - s2;
  var rotrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
  var rotrBH = (h, l, s2) => h << 64 - s2 | l >>> s2 - 32;
  var rotrBL = (h, l, s2) => h >>> s2 - 32 | l << 64 - s2;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  var HashMD = class extends Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
      super();
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "padOffset");
      __publicField(this, "isLE");
      __publicField(this, "buffer");
      __publicField(this, "view");
      __publicField(this, "finished", false);
      __publicField(this, "length", 0);
      __publicField(this, "pos", 0);
      __publicField(this, "destroyed", false);
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      data = toBytes(data);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos; i < blockLen; i++)
        buffer[i] = 0;
      setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4 !== 0)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor());
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen !== 0)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n2 & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  var SHA256_IV = Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  var K2562 = Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = new Uint32Array(64);
  var FastSHA256 = class extends HashMD {
    constructor(outputLen = 32) {
      super(64, outputLen, 8, false);
      __publicField(this, "A", SHA256_IV[0] | 0);
      __publicField(this, "B", SHA256_IV[1] | 0);
      __publicField(this, "C", SHA256_IV[2] | 0);
      __publicField(this, "D", SHA256_IV[3] | 0);
      __publicField(this, "E", SHA256_IV[4] | 0);
      __publicField(this, "F", SHA256_IV[5] | 0);
      __publicField(this, "G", SHA256_IV[6] | 0);
      __publicField(this, "H", SHA256_IV[7] | 0);
    }
    get() {
      const { A: A2, B: B2, C, D, E, F, G, H } = this;
      return [A2, B2, C, D, E, F, G, H];
    }
    set(A2, B2, C, D, E, F, G, H) {
      this.A = A2 | 0;
      this.B = B2 | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4) {
        SHA256_W[i] = view.getUint32(offset);
      }
      for (let i = 16; i < 64; i++) {
        const w15 = SHA256_W[i - 15];
        const w2 = SHA256_W[i - 2];
        const s0 = G0_256(w15);
        const s1 = G1_256(w2);
        SHA256_W[i] = sum32(sum32(s0, SHA256_W[i - 7]), sum32(s1, SHA256_W[i - 16]));
      }
      let { A: A2, B: B2, C, D, E, F, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const T1 = SUM32_5(H, S1_256(E), ch32(E, F, G), K2562[i], SHA256_W[i]);
        const T2 = sum32(S0_256(A2), maj32(A2, B2, C));
        H = G;
        G = F;
        F = E;
        E = sum32(D, T1);
        D = C;
        C = B2;
        B2 = A2;
        A2 = sum32(T1, T2);
      }
      this.A = sum32(this.A, A2);
      this.B = sum32(this.B, B2);
      this.C = sum32(this.C, C);
      this.D = sum32(this.D, D);
      this.E = sum32(this.E, E);
      this.F = sum32(this.F, F);
      this.G = sum32(this.G, G);
      this.H = sum32(this.H, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var sha256Fast = createHasher(() => new FastSHA256());
  var SHA512_IV = Uint32Array.from([
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ]);
  var K512 = (() => split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map((n) => BigInt(n))))();
  var SHA512_Kh = (() => K512[0])();
  var SHA512_Kl = (() => K512[1])();
  var SHA512_W_H = new Uint32Array(80);
  var SHA512_W_L = new Uint32Array(80);
  var FastSHA512 = class extends HashMD {
    constructor(outputLen = 64) {
      super(128, outputLen, 16, false);
      __publicField(this, "Ah", SHA512_IV[0] | 0);
      __publicField(this, "Al", SHA512_IV[1] | 0);
      __publicField(this, "Bh", SHA512_IV[2] | 0);
      __publicField(this, "Bl", SHA512_IV[3] | 0);
      __publicField(this, "Ch", SHA512_IV[4] | 0);
      __publicField(this, "Cl", SHA512_IV[5] | 0);
      __publicField(this, "Dh", SHA512_IV[6] | 0);
      __publicField(this, "Dl", SHA512_IV[7] | 0);
      __publicField(this, "Eh", SHA512_IV[8] | 0);
      __publicField(this, "El", SHA512_IV[9] | 0);
      __publicField(this, "Fh", SHA512_IV[10] | 0);
      __publicField(this, "Fl", SHA512_IV[11] | 0);
      __publicField(this, "Gh", SHA512_IV[12] | 0);
      __publicField(this, "Gl", SHA512_IV[13] | 0);
      __publicField(this, "Hh", SHA512_IV[14] | 0);
      __publicField(this, "Hl", SHA512_IV[15] | 0);
    }
    get() {
      const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset += 4);
      }
      for (let i = 16; i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0; i < 80; i++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
        const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl | 0;
        Bh = Ah | 0;
        Bl = Al | 0;
        const T2l = add3L(sigma0l, MAJl, T1l);
        Ah = add3H(T2l, sigma0h, MAJh, T1h);
        Al = T2l | 0;
      }
      ;
      ({ h: Ah, l: Al } = add(Ah, Al, this.Ah, this.Al));
      ({ h: Bh, l: Bl } = add(Bh, Bl, this.Bh, this.Bl));
      ({ h: Ch, l: Cl } = add(Ch, Cl, this.Ch, this.Cl));
      ({ h: Dh, l: Dl } = add(Dh, Dl, this.Dh, this.Dl));
      ({ h: Eh, l: El } = add(Eh, El, this.Eh, this.El));
      ({ h: Fh, l: Fl } = add(Fh, Fl, this.Fh, this.Fl));
      ({ h: Gh, l: Gl } = add(Gh, Gl, this.Gh, this.Gl));
      ({ h: Hh, l: Hl } = add(Hh, Hl, this.Hh, this.Hl));
      this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      clean(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var sha512Fast = createHasher(() => new FastSHA512());
  var HMAC = class extends Hash {
    constructor(hash, _key) {
      super();
      __publicField(this, "oHash");
      __publicField(this, "iHash");
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "finished", false);
      __publicField(this, "destroyed", false);
      ahash(hash);
      const key = toBytes(_key);
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function") {
        throw new Error("Expected instance of class which extends utils.Hash");
      }
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      abytes(out, this.outputLen);
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash ?? void 0);
      to.iHash = iHash._cloneInto(to.iHash ?? void 0);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  function pbkdf2Core(hash, password, salt, opts) {
    ahash(hash);
    const { c, dkLen } = Object.assign({ dkLen: 32 }, opts);
    anumber(c);
    anumber(dkLen);
    if (c < 1)
      throw new Error("iterations (c) should be >= 1");
    const pwd = kdfInputToBytes(password);
    const slt = kdfInputToBytes(salt);
    const DK = new Uint8Array(dkLen);
    const PRF = hmac.create(hash, pwd);
    const PRFSalt = PRF._cloneInto().update(slt);
    let prfW;
    const arr = new Uint8Array(4);
    const view = createView(arr);
    const u = new Uint8Array(PRF.outputLen);
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
      const Ti = DK.subarray(pos, pos + PRF.outputLen);
      view.setInt32(0, ti, false);
      (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
      Ti.set(u.subarray(0, Ti.length));
      for (let ui = 1; ui < c; ui++) {
        PRF._cloneInto(prfW).update(u).digestInto(u);
        for (let i = 0; i < Ti.length; i++)
          Ti[i] ^= u[i];
      }
    }
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW != null)
      prfW.destroy();
    clean(u);
    return DK;
  }
  var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
  hmac.create = (hash, key) => new HMAC(hash, key);
  function pbkdf2Fast(password, salt, iterations, keylen) {
    return pbkdf2Core(sha512Fast, password, salt, { c: iterations, dkLen: keylen });
  }
  function pbkdf2(password, salt, iterations, keylen, digest = "sha512") {
    if (digest !== "sha512") {
      throw new Error("Only sha512 is supported in this PBKDF2 implementation");
    }
    try {
      const nodeCrypto = __require("crypto");
      if (typeof nodeCrypto.pbkdf2Sync === "function") {
        const p2 = Buffer.from(password);
        const s3 = Buffer.from(salt);
        return [...nodeCrypto.pbkdf2Sync(p2, s3, iterations, keylen, digest)];
      }
    } catch {
    }
    const p = Uint8Array.from(password);
    const s2 = Uint8Array.from(salt);
    const out = pbkdf2Fast(p, s2, iterations, keylen);
    return Array.from(out);
  }
  function swapBytes32(w) {
    const res = w >>> 24 | w >>> 8 & 65280 | w << 8 & 16711680 | (w & 255) << 24;
    return res >>> 0;
  }
  var isLittleEndian = (() => {
    const b = new ArrayBuffer(4);
    const a = new Uint32Array(b);
    const c = new Uint8Array(b);
    a[0] = 16909060;
    return c[0] === 4;
  })();
  function realHtonl(w) {
    return isLittleEndian ? swapBytes32(w) : w >>> 0;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/WriterUint8Array.js
  var WriterUint8Array = class {
    constructor(bufs, initialCapacity = 256) {
      __publicField(this, "buffer");
      __publicField(this, "pos");
      __publicField(this, "capacity");
      if (bufs != null && bufs.length > 0) {
        const totalLength = bufs.reduce((sum, buf) => sum + buf.length, 0);
        initialCapacity = Math.max(initialCapacity, totalLength);
      }
      this.buffer = new Uint8Array(initialCapacity);
      this.pos = 0;
      this.capacity = initialCapacity;
      if (bufs != null) {
        for (const buf of bufs) {
          this.write(buf);
        }
      }
    }
    /**
     * Returns the current length of written data
     */
    getLength() {
      return this.pos;
    }
    /**
     * @return the written data as Uint8Array copy of the internal buffer
     */
    toUint8Array() {
      return this.buffer.slice(0, this.pos);
    }
    /**
     * Legacy compatibility method – returns number[] (Byte[])
     */
    toArray() {
      return Array.from(this.toUint8Array());
    }
    /**
     * @return the written data as Uint8Array. CAUTION: This is zero-copy subarray of the internal buffer).
     */
    toUint8ArrayZeroCopy() {
      return this.buffer.subarray(0, this.pos);
    }
    ensureCapacity(needed) {
      if (this.pos + needed > this.capacity) {
        let newCapacity = this.capacity * 2;
        while (this.pos + needed > newCapacity) {
          newCapacity *= 2;
        }
        const newBuffer = new Uint8Array(newCapacity);
        newBuffer.set(this.buffer);
        this.buffer = newBuffer;
        this.capacity = newCapacity;
      }
    }
    write(bytes2) {
      const data = bytes2 instanceof Uint8Array ? bytes2 : new Uint8Array(bytes2);
      this.ensureCapacity(data.length);
      this.buffer.set(data, this.pos);
      this.pos += data.length;
      return this;
    }
    writeReverse(buf) {
      const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      this.ensureCapacity(data.length);
      for (let i = data.length - 1; i >= 0; i--) {
        this.buffer[this.pos] = data[i];
        this.pos += 1;
      }
      return this;
    }
    writeUInt8(value) {
      this.ensureCapacity(1);
      this.buffer[this.pos] = value & 255;
      this.pos += 1;
      return this;
    }
    writeInt8(value) {
      this.writeUInt8(value);
      return this;
    }
    writeUInt16LE(value) {
      this.ensureCapacity(2);
      this.buffer[this.pos] = value & 255;
      this.buffer[this.pos + 1] = value >> 8 & 255;
      this.pos += 2;
      return this;
    }
    writeUInt16BE(value) {
      this.ensureCapacity(2);
      this.buffer[this.pos] = value >> 8 & 255;
      this.buffer[this.pos + 1] = value & 255;
      this.pos += 2;
      return this;
    }
    writeInt16LE(value) {
      this.writeUInt16LE(value & 65535);
      return this;
    }
    writeInt16BE(value) {
      this.writeUInt16BE(value & 65535);
      return this;
    }
    writeUInt32LE(value) {
      this.ensureCapacity(4);
      this.buffer[this.pos] = value & 255;
      this.buffer[this.pos + 1] = value >> 8 & 255;
      this.buffer[this.pos + 2] = value >> 16 & 255;
      this.buffer[this.pos + 3] = value >> 24 & 255;
      this.pos += 4;
      return this;
    }
    writeUInt32BE(value) {
      this.ensureCapacity(4);
      this.buffer[this.pos] = value >> 24 & 255;
      this.buffer[this.pos + 1] = value >> 16 & 255;
      this.buffer[this.pos + 2] = value >> 8 & 255;
      this.buffer[this.pos + 3] = value & 255;
      this.pos += 4;
      return this;
    }
    writeInt32LE(value) {
      this.writeUInt32LE(value >>> 0);
      return this;
    }
    writeInt32BE(value) {
      this.writeUInt32BE(value >>> 0);
      return this;
    }
    writeUInt64BEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.write(buf);
      return this;
    }
    writeUInt64LEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeUInt64LE(n) {
      const buf = new BigNumber(n).toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeVarIntNum(n) {
      const buf = Writer.varIntNum(n);
      this.write(buf);
      return this;
    }
    writeVarIntBn(bn) {
      const buf = Writer.varIntBn(bn);
      this.write(buf);
      return this;
    }
    /**
     * Resets the writer to empty state (reuses the buffer)
     */
    reset() {
      this.pos = 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ReaderUint8Array.js
  var ReaderUint8Array = class _ReaderUint8Array {
    constructor(bin = new Uint8Array(0), pos = 0) {
      __publicField(this, "bin");
      __publicField(this, "pos");
      __publicField(this, "length");
      if (bin instanceof Uint8Array) {
        this.bin = bin;
      } else if (Array.isArray(bin)) {
        this.bin = new Uint8Array(bin);
      } else {
        throw new Error("ReaderUint8Array constructor: bin must be Uint8Array or number[]");
      }
      this.pos = pos;
      this.length = this.bin.length;
    }
    static makeReader(bin, pos = 0) {
      if (bin instanceof Uint8Array) {
        return new _ReaderUint8Array(bin, pos);
      }
      if (Array.isArray(bin)) {
        return new Reader(bin, pos);
      }
      throw new Error("ReaderUint8Array.makeReader: bin must be Uint8Array or number[]");
    }
    eof() {
      return this.pos >= this.length;
    }
    read(len = this.length) {
      const start = this.pos;
      const end = this.pos + len;
      this.pos = end;
      return this.bin.slice(start, end);
    }
    readReverse(len = this.length) {
      const buf2 = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf2[i] = this.bin[this.pos + len - 1 - i];
      }
      this.pos += len;
      return buf2;
    }
    readUInt8() {
      const val = this.bin[this.pos];
      this.pos += 1;
      return val;
    }
    readInt8() {
      const val = this.bin[this.pos];
      this.pos += 1;
      return (val & 128) !== 0 ? val - 256 : val;
    }
    readUInt16BE() {
      const val = this.bin[this.pos] << 8 | this.bin[this.pos + 1];
      this.pos += 2;
      return val;
    }
    readInt16BE() {
      const val = this.readUInt16BE();
      return (val & 32768) !== 0 ? val - 65536 : val;
    }
    readUInt16LE() {
      const val = this.bin[this.pos] | this.bin[this.pos + 1] << 8;
      this.pos += 2;
      return val;
    }
    readInt16LE() {
      const val = this.readUInt16LE();
      const x = (val & 32768) !== 0 ? val - 65536 : val;
      return x;
    }
    readUInt32BE() {
      const val = this.bin[this.pos] * 16777216 + // Shift the first byte by 24 bits
      (this.bin[this.pos + 1] << 16 | // Shift the second byte by 16 bits
      this.bin[this.pos + 2] << 8 | // Shift the third byte by 8 bits
      this.bin[this.pos + 3]);
      this.pos += 4;
      return val;
    }
    readInt32BE() {
      const val = this.readUInt32BE();
      return (val & 2147483648) !== 0 ? val - 4294967296 : val;
    }
    readUInt32LE() {
      const val = (this.bin[this.pos] | this.bin[this.pos + 1] << 8 | this.bin[this.pos + 2] << 16 | this.bin[this.pos + 3] << 24) >>> 0;
      this.pos += 4;
      return val;
    }
    readInt32LE() {
      const val = this.readUInt32LE();
      return (val & 2147483648) !== 0 ? val - 4294967296 : val;
    }
    readUInt64BEBn() {
      const bin = Array.from(this.bin.slice(this.pos, this.pos + 8));
      const bn = new BigNumber(bin);
      this.pos = this.pos + 8;
      return bn;
    }
    readUInt64LEBn() {
      const bin = Array.from(this.readReverse(8));
      const bn = new BigNumber(bin);
      return bn;
    }
    readInt64LEBn() {
      const OverflowInt642 = new BigNumber(2).pow(new BigNumber(63));
      const OverflowUint642 = new BigNumber(2).pow(new BigNumber(64));
      const bin = Array.from(this.readReverse(8));
      let bn = new BigNumber(bin);
      if (bn.gte(OverflowInt642)) {
        bn = bn.sub(OverflowUint642);
      }
      return bn;
    }
    readVarIntNum(signed = true) {
      const first = this.readUInt8();
      let bn;
      switch (first) {
        case 253:
          return this.readUInt16LE();
        case 254:
          return this.readUInt32LE();
        case 255:
          bn = signed ? this.readInt64LEBn() : this.readUInt64LEBn();
          if (bn.lte(new BigNumber(2).pow(new BigNumber(53)))) {
            return bn.toNumber();
          } else {
            throw new Error("number too large to retain precision - use readVarIntBn");
          }
        default:
          return first;
      }
    }
    readVarInt() {
      const first = this.bin[this.pos];
      switch (first) {
        case 253:
          return this.read(1 + 2);
        case 254:
          return this.read(1 + 4);
        case 255:
          return this.read(1 + 8);
        default:
          return this.read(1);
      }
    }
    readVarIntBn() {
      const first = this.readUInt8();
      switch (first) {
        case 253:
          return new BigNumber(this.readUInt16LE());
        case 254:
          return new BigNumber(this.readUInt32LE());
        case 255:
          return this.readUInt64LEBn();
        default:
          return new BigNumber(first);
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/utils.js
  var BufferCtor2 = typeof globalThis !== "undefined" ? globalThis.Buffer : void 0;
  var CAN_USE_BUFFER2 = BufferCtor2 != null && typeof BufferCtor2.from === "function";
  var HEX_DIGITS = "0123456789abcdef";
  var HEX_BYTE_STRINGS = new Array(256);
  for (let i = 0; i < 256; i++) {
    HEX_BYTE_STRINGS[i] = HEX_DIGITS[i >> 4 & 15] + HEX_DIGITS[i & 15];
  }
  var toHex = (msg) => {
    if (CAN_USE_BUFFER2) {
      return BufferCtor2.from(msg).toString("hex");
    }
    if (msg.length === 0)
      return "";
    const out = new Array(msg.length);
    for (let i = 0; i < msg.length; i++) {
      out[i] = HEX_BYTE_STRINGS[msg[i] & 255];
    }
    return out.join("");
  };
  var toUint8Array = (msg, enc) => {
    if (msg instanceof Uint8Array)
      return msg;
    return new Uint8Array(toArray2(msg, enc));
  };
  var toArray2 = (msg, enc) => {
    if (Array.isArray(msg))
      return msg.slice();
    if (msg === void 0)
      return [];
    if (typeof msg !== "string") {
      return Array.from(msg, (item) => item | 0);
    }
    switch (enc) {
      case "hex":
        return hexToArray(msg);
      case "base64":
        return base64ToArray(msg);
      default:
        return utf8ToArray(msg);
    }
  };
  var HEX_CHAR_TO_VALUE2 = new Int8Array(256).fill(-1);
  for (let i = 0; i < 10; i++) {
    HEX_CHAR_TO_VALUE2[48 + i] = i;
  }
  for (let i = 0; i < 6; i++) {
    HEX_CHAR_TO_VALUE2[65 + i] = 10 + i;
    HEX_CHAR_TO_VALUE2[97 + i] = 10 + i;
  }
  var hexToArray = (msg) => {
    assertValidHex(msg);
    const normalized = msg.length % 2 === 0 ? msg : "0" + msg;
    if (CAN_USE_BUFFER2) {
      return Array.from(BufferCtor2.from(normalized, "hex"));
    }
    const out = new Array(normalized.length / 2);
    let o = 0;
    for (let i = 0; i < normalized.length; i += 2) {
      const hi = HEX_CHAR_TO_VALUE2[normalized.charCodeAt(i)];
      const lo = HEX_CHAR_TO_VALUE2[normalized.charCodeAt(i + 1)];
      out[o++] = hi << 4 | lo;
    }
    return out;
  };
  function base64ToArray(msg) {
    if (typeof msg !== "string") {
      throw new TypeError("msg must be a string");
    }
    let s2 = msg.trim().replace(/[\r\n\t\f\v ]+/g, "");
    s2 = s2.replace(/-/g, "+").replace(/_/g, "/");
    const padIndex = s2.indexOf("=");
    if (padIndex !== -1) {
      const pad = s2.slice(padIndex);
      if (!/^={1,2}$/.test(pad)) {
        throw new Error("Invalid base64 padding");
      }
      if (s2.slice(0, padIndex).includes("=")) {
        throw new Error("Invalid base64 padding");
      }
      s2 = s2.slice(0, padIndex);
    }
    const result = [];
    let bitBuffer = 0;
    let bitCount = 0;
    for (let i = 0; i < s2.length; i++) {
      const c = s2.charCodeAt(i);
      let v = -1;
      if (c >= 65 && c <= 90) {
        v = c - 65;
      } else if (c >= 97 && c <= 122) {
        v = c - 97 + 26;
      } else if (c >= 48 && c <= 57) {
        v = c - 48 + 52;
      } else if (c === 43) {
        v = 62;
      } else if (c === 47) {
        v = 63;
      } else {
        throw new Error(`Invalid base64 character at index ${i}`);
      }
      bitBuffer = bitBuffer << 6 | v;
      bitCount += 6;
      while (bitCount >= 8) {
        bitCount -= 8;
        result.push(bitBuffer >> bitCount & 255);
        bitBuffer &= (1 << bitCount) - 1;
      }
    }
    return result;
  }
  function utf8ToArray(str) {
    const result = [];
    for (let i = 0; i < str.length; i++) {
      const cp = str.codePointAt(i);
      if (cp === void 0) {
        throw new Error(`Index out of range: ${i}`);
      }
      let codePoint = cp;
      if (codePoint > 65535) {
        i++;
      } else {
        if (codePoint >= 55296 && codePoint <= 57343) {
          codePoint = 65533;
        }
      }
      if (codePoint <= 127) {
        result.push(codePoint);
      } else if (codePoint <= 2047) {
        result.push(192 | codePoint >> 6, 128 | codePoint & 63);
      } else if (codePoint <= 65535) {
        result.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
      } else {
        result.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
      }
    }
    return result;
  }
  var toUTF8 = (arr) => {
    let result = "";
    const replacementChar = "\uFFFD";
    for (let i = 0; i < arr.length; i++) {
      const byte1 = arr[i];
      if (byte1 <= 127) {
        result += String.fromCharCode(byte1);
        continue;
      }
      const emitReplacement = () => {
        result += replacementChar;
      };
      if (byte1 >= 192 && byte1 <= 223) {
        if (i + 1 >= arr.length) {
          emitReplacement();
          continue;
        }
        const byte2 = arr[i + 1];
        if ((byte2 & 192) !== 128) {
          emitReplacement();
          i += 1;
          continue;
        }
        const codePoint = (byte1 & 31) << 6 | byte2 & 63;
        result += String.fromCharCode(codePoint);
        i += 1;
        continue;
      }
      if (byte1 >= 224 && byte1 <= 239) {
        if (i + 2 >= arr.length) {
          emitReplacement();
          continue;
        }
        const byte2 = arr[i + 1];
        const byte3 = arr[i + 2];
        if ((byte2 & 192) !== 128 || (byte3 & 192) !== 128) {
          emitReplacement();
          i += 2;
          continue;
        }
        const codePoint = (byte1 & 15) << 12 | (byte2 & 63) << 6 | byte3 & 63;
        result += String.fromCharCode(codePoint);
        i += 2;
        continue;
      }
      if (byte1 >= 240 && byte1 <= 247) {
        if (i + 3 >= arr.length) {
          emitReplacement();
          continue;
        }
        const byte2 = arr[i + 1];
        const byte3 = arr[i + 2];
        const byte4 = arr[i + 3];
        if ((byte2 & 192) !== 128 || (byte3 & 192) !== 128 || (byte4 & 192) !== 128) {
          emitReplacement();
          i += 3;
          continue;
        }
        const codePoint = (byte1 & 7) << 18 | (byte2 & 63) << 12 | (byte3 & 63) << 6 | byte4 & 63;
        const offset = codePoint - 65536;
        const highSurrogate = 55296 + (offset >> 10);
        const lowSurrogate = 56320 + (offset & 1023);
        result += String.fromCharCode(highSurrogate, lowSurrogate);
        i += 3;
        continue;
      }
      emitReplacement();
    }
    return result;
  };
  var encode = (arr, enc) => {
    switch (enc) {
      case "hex":
        return toHex(arr);
      case "utf8":
        return toUTF8(arr);
      // If no encoding is provided, return the original array
      default:
        return arr;
    }
  };
  function toBase64(byteArray) {
    const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    let i;
    for (i = 0; i < byteArray.length; i += 3) {
      const byte1 = byteArray[i];
      const byte2 = i + 1 < byteArray.length ? byteArray[i + 1] : 0;
      const byte3 = i + 2 < byteArray.length ? byteArray[i + 2] : 0;
      const encoded1 = byte1 >> 2;
      const encoded2 = (byte1 & 3) << 4 | byte2 >> 4;
      const encoded3 = (byte2 & 15) << 2 | byte3 >> 6;
      const encoded4 = byte3 & 63;
      result += base64Chars.charAt(encoded1) + base64Chars.charAt(encoded2);
      result += i + 1 < byteArray.length ? base64Chars.charAt(encoded3) : "=";
      result += i + 2 < byteArray.length ? base64Chars.charAt(encoded4) : "=";
    }
    return result;
  }
  var base58chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var fromBase58 = (str) => {
    if (str === "" || typeof str !== "string") {
      throw new Error(`Expected base58 string but got \u201C${str}\u201D`);
    }
    const match = str.match(/[IOl0]/gmu);
    if (match !== null) {
      throw new Error(`Invalid base58 character \u201C${match.join("")}\u201D`);
    }
    const lz = str.match(/^1+/gmu);
    const psz = lz !== null ? lz[0].length : 0;
    const size = (str.length - psz) * (Math.log(58) / Math.log(256)) + 1 >>> 0;
    const uint8 = new Uint8Array([
      ...new Uint8Array(psz),
      ...(str.match(/./gmu) ?? []).map((i) => base58chars.indexOf(i)).reduce((acc, i) => {
        acc = acc.map((j) => {
          const x = j * 58 + i;
          i = x >> 8;
          return x;
        });
        return acc;
      }, new Uint8Array(size)).reverse().filter(/* @__PURE__ */ ((lastValue) => (value) => (
        // @ts-expect-error
        lastValue = lastValue || value
      ))(false))
    ]);
    return [...uint8];
  };
  var toBase58 = (bin) => {
    const base58Map = Array(256).fill(-1);
    for (let i = 0; i < base58chars.length; ++i) {
      base58Map[base58chars.charCodeAt(i)] = i;
    }
    const result = [];
    for (const byte of bin) {
      let carry = byte;
      for (let j = 0; j < result.length; ++j) {
        const x = (base58Map[result[j]] << 8) + carry;
        result[j] = base58chars.charCodeAt(x % 58);
        carry = x / 58 | 0;
      }
      while (carry !== 0) {
        result.push(base58chars.charCodeAt(carry % 58));
        carry = carry / 58 | 0;
      }
    }
    for (const byte of bin) {
      if (byte !== 0)
        break;
      else
        result.push("1".charCodeAt(0));
    }
    result.reverse();
    return String.fromCharCode(...result);
  };
  var toBase58Check = (bin, prefix = [0]) => {
    let hash = hash256([...prefix, ...bin]);
    hash = [...prefix, ...bin, ...hash.slice(0, 4)];
    return toBase58(hash);
  };
  var fromBase58Check = (str, enc, prefixLength = 1) => {
    const bin = fromBase58(str);
    let prefix = bin.slice(0, prefixLength);
    let data = bin.slice(prefixLength, -4);
    let hash = [...prefix, ...data];
    hash = hash256(hash);
    bin.slice(-4).forEach((check, index) => {
      if (check !== hash[index]) {
        throw new Error("Invalid checksum");
      }
    });
    if (enc === "hex") {
      prefix = toHex(prefix);
      data = toHex(data);
    }
    return { prefix, data };
  };
  var Writer = class _Writer {
    constructor(bufs) {
      __publicField(this, "bufs");
      __publicField(this, "length");
      this.bufs = bufs !== void 0 ? bufs : [];
      this.length = 0;
      for (const b of this.bufs)
        this.length += b.length;
    }
    getLength() {
      return this.length;
    }
    toUint8Array() {
      const out = new Uint8Array(this.length);
      let offset = 0;
      for (const buf of this.bufs) {
        out.set(buf, offset);
        offset += buf.length;
      }
      return out;
    }
    toArray() {
      const totalLength = this.length;
      const ret = new Array(totalLength);
      let offset = 0;
      for (const buf of this.bufs) {
        if (buf instanceof Uint8Array) {
          for (let i = 0; i < buf.length; i++) {
            ret[offset++] = buf[i];
          }
        } else {
          const arr = buf;
          for (let i = 0; i < arr.length; i++) {
            ret[offset++] = arr[i];
          }
        }
      }
      return ret;
    }
    write(buf) {
      this.bufs.push(buf);
      this.length += buf.length;
      return this;
    }
    writeReverse(buf) {
      const buf2 = new Array(buf.length);
      for (let i = 0; i < buf2.length; i++) {
        buf2[i] = buf[buf.length - 1 - i];
      }
      return this.write(buf2);
    }
    writeUInt8(n) {
      const buf = new Array(1);
      buf[0] = n & 255;
      this.write(buf);
      return this;
    }
    writeInt8(n) {
      const buf = new Array(1);
      buf[0] = n & 255;
      this.write(buf);
      return this;
    }
    writeUInt16BE(n) {
      const buf = [
        n >> 8 & 255,
        // shift right 8 bits to get the high byte
        n & 255
        // low byte is just the last 8 bits
      ];
      return this.write(buf);
    }
    writeInt16BE(n) {
      return this.writeUInt16BE(n & 65535);
    }
    writeUInt16LE(n) {
      const buf = [
        n & 255,
        // low byte is just the last 8 bits
        n >> 8 & 255
        // shift right 8 bits to get the high byte
      ];
      return this.write(buf);
    }
    writeInt16LE(n) {
      return this.writeUInt16LE(n & 65535);
    }
    writeUInt32BE(n) {
      const buf = [
        n >> 24 & 255,
        // highest byte
        n >> 16 & 255,
        n >> 8 & 255,
        n & 255
        // lowest byte
      ];
      return this.write(buf);
    }
    writeInt32BE(n) {
      return this.writeUInt32BE(n >>> 0);
    }
    writeUInt32LE(n) {
      const buf = [
        n & 255,
        // lowest byte
        n >> 8 & 255,
        n >> 16 & 255,
        n >> 24 & 255
        // highest byte
      ];
      return this.write(buf);
    }
    writeInt32LE(n) {
      return this.writeUInt32LE(n >>> 0);
    }
    writeUInt64BEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.write(buf);
      return this;
    }
    writeUInt64LEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeUInt64LE(n) {
      const buf = new BigNumber(n).toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeVarIntNum(n) {
      const buf = _Writer.varIntNum(n);
      this.write(buf);
      return this;
    }
    writeVarIntBn(bn) {
      const buf = _Writer.varIntBn(bn);
      this.write(buf);
      return this;
    }
    static varIntNum(n) {
      let buf;
      if (n < 0) {
        return this.varIntBn(new BigNumber(n));
      }
      if (n < 253) {
        buf = [n];
      } else if (n < 65536) {
        buf = [
          253,
          // 0xfd
          n & 255,
          // low byte
          n >> 8 & 255
          // high byte
        ];
      } else if (n < 4294967296) {
        buf = [
          254,
          // 0xfe
          n & 255,
          n >> 8 & 255,
          n >> 16 & 255,
          n >> 24 & 255
        ];
      } else {
        const low = n & 4294967295;
        const high = Math.floor(n / 4294967296) & 4294967295;
        buf = [
          255,
          // 0xff
          low & 255,
          low >> 8 & 255,
          low >> 16 & 255,
          low >> 24 & 255,
          high & 255,
          high >> 8 & 255,
          high >> 16 & 255,
          high >> 24 & 255
        ];
      }
      return buf;
    }
    static varIntBn(bn) {
      let buf;
      if (bn.isNeg()) {
        bn = bn.add(OverflowUint64);
      }
      if (bn.ltn(253)) {
        const n = bn.toNumber();
        buf = [n];
      } else if (bn.ltn(65536)) {
        const n = bn.toNumber();
        buf = [253, n & 255, n >> 8 & 255];
      } else if (bn.lt(new BigNumber(4294967296))) {
        const n = bn.toNumber();
        buf = [
          254,
          n & 255,
          n >> 8 & 255,
          n >> 16 & 255,
          n >> 24 & 255
        ];
      } else {
        const bw = new _Writer();
        bw.writeUInt8(255);
        bw.writeUInt64LEBn(bn);
        buf = bw.toArray();
      }
      return buf;
    }
  };
  var Reader = class {
    constructor(bin = [], pos = 0) {
      __publicField(this, "bin");
      __publicField(this, "pos");
      __publicField(this, "length");
      this.bin = bin;
      this.pos = pos;
      this.length = bin.length;
    }
    eof() {
      return this.pos >= this.length;
    }
    read(len = this.length) {
      const start = this.pos;
      const end = this.pos + len;
      this.pos = end;
      return this.bin.slice(start, end);
    }
    readReverse(len = this.length) {
      const buf2 = new Array(len);
      for (let i = 0; i < len; i++) {
        buf2[i] = this.bin[this.pos + len - 1 - i];
      }
      this.pos += len;
      return buf2;
    }
    readUInt8() {
      const val = this.bin[this.pos];
      this.pos += 1;
      return val;
    }
    readInt8() {
      const val = this.bin[this.pos];
      this.pos += 1;
      return (val & 128) !== 0 ? val - 256 : val;
    }
    readUInt16BE() {
      const val = this.bin[this.pos] << 8 | this.bin[this.pos + 1];
      this.pos += 2;
      return val;
    }
    readInt16BE() {
      const val = this.readUInt16BE();
      return (val & 32768) !== 0 ? val - 65536 : val;
    }
    readUInt16LE() {
      const val = this.bin[this.pos] | this.bin[this.pos + 1] << 8;
      this.pos += 2;
      return val;
    }
    readInt16LE() {
      const val = this.readUInt16LE();
      const x = (val & 32768) !== 0 ? val - 65536 : val;
      return x;
    }
    readUInt32BE() {
      const val = this.bin[this.pos] * 16777216 + // Shift the first byte by 24 bits
      (this.bin[this.pos + 1] << 16 | // Shift the second byte by 16 bits
      this.bin[this.pos + 2] << 8 | // Shift the third byte by 8 bits
      this.bin[this.pos + 3]);
      this.pos += 4;
      return val;
    }
    readInt32BE() {
      const val = this.readUInt32BE();
      return (val & 2147483648) !== 0 ? val - 4294967296 : val;
    }
    readUInt32LE() {
      const val = (this.bin[this.pos] | this.bin[this.pos + 1] << 8 | this.bin[this.pos + 2] << 16 | this.bin[this.pos + 3] << 24) >>> 0;
      this.pos += 4;
      return val;
    }
    readInt32LE() {
      const val = this.readUInt32LE();
      return (val & 2147483648) !== 0 ? val - 4294967296 : val;
    }
    readUInt64BEBn() {
      const bin = this.bin.slice(this.pos, this.pos + 8);
      const bn = new BigNumber(bin);
      this.pos = this.pos + 8;
      return bn;
    }
    readUInt64LEBn() {
      const bin = this.readReverse(8);
      const bn = new BigNumber(bin);
      return bn;
    }
    readInt64LEBn() {
      const bin = this.readReverse(8);
      let bn = new BigNumber(bin);
      if (bn.gte(OverflowInt64)) {
        bn = bn.sub(OverflowUint64);
      }
      return bn;
    }
    readVarIntNum(signed = true) {
      const first = this.readUInt8();
      let bn;
      switch (first) {
        case 253:
          return this.readUInt16LE();
        case 254:
          return this.readUInt32LE();
        case 255:
          bn = signed ? this.readInt64LEBn() : this.readUInt64LEBn();
          if (bn.lte(new BigNumber(2).pow(new BigNumber(53)))) {
            return bn.toNumber();
          } else {
            throw new Error("number too large to retain precision - use readVarIntBn");
          }
        default:
          return first;
      }
    }
    readVarInt() {
      const first = this.bin[this.pos];
      switch (first) {
        case 253:
          return this.read(1 + 2);
        case 254:
          return this.read(1 + 4);
        case 255:
          return this.read(1 + 8);
        default:
          return this.read(1);
      }
    }
    readVarIntBn() {
      const first = this.readUInt8();
      switch (first) {
        case 253:
          return new BigNumber(this.readUInt16LE());
        case 254:
          return new BigNumber(this.readUInt32LE());
        case 255:
          return this.readUInt64LEBn();
        default:
          return new BigNumber(first);
      }
    }
  };
  var minimallyEncode = (buf) => {
    if (buf.length === 0) {
      return buf;
    }
    const last = buf[buf.length - 1];
    if ((last & 127) !== 0) {
      return buf;
    }
    if (buf.length === 1) {
      return [];
    }
    if ((buf[buf.length - 2] & 128) !== 0) {
      return buf;
    }
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1] !== 0) {
        if ((buf[i - 1] & 128) !== 0) {
          buf[i] = last;
          return buf.slice(0, i + 1);
        } else {
          buf[i - 1] |= last;
          return buf.slice(0, i);
        }
      }
    }
    return [];
  };
  var OverflowInt64 = new BigNumber(2).pow(new BigNumber(63));
  var OverflowUint64 = new BigNumber(2).pow(new BigNumber(64));
  function verifyNotNull(value, errorMessage = "Expected a valid value, but got undefined or null.") {
    if (value == null)
      throw new Error(errorMessage);
    return value;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Point.js
  function ctSwap(swap, a, b) {
    const mask = -swap;
    const swapX = (a.X ^ b.X) & mask;
    const swapY = (a.Y ^ b.Y) & mask;
    const swapZ = (a.Z ^ b.Z) & mask;
    a.X ^= swapX;
    b.X ^= swapX;
    a.Y ^= swapY;
    b.Y ^= swapY;
    a.Z ^= swapZ;
    b.Z ^= swapZ;
  }
  var BI_ZERO = 0n;
  var BI_ONE = 1n;
  var BI_TWO = 2n;
  var BI_THREE = 3n;
  var BI_FOUR = 4n;
  var BI_EIGHT = 8n;
  var P_BIGINT = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var N_BIGINT = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var MASK_256 = (1n << 256n) - 1n;
  function red(x) {
    let hi = x >> 256n;
    x = (x & MASK_256) + (hi << 32n) + hi * 977n;
    hi = x >> 256n;
    x = (x & MASK_256) + (hi << 32n) + hi * 977n;
    if (x >= P_BIGINT)
      x -= P_BIGINT;
    return x;
  }
  var biMod = (a) => red((a % P_BIGINT + P_BIGINT) % P_BIGINT);
  var biModSub = (a, b) => a >= b ? a - b : P_BIGINT - (b - a);
  var biModMul = (a, b) => red(a * b);
  var biModAdd = (a, b) => red(a + b);
  var biModInv = (a) => {
    let lm = BI_ONE;
    let hm = BI_ZERO;
    let low = biMod(a);
    let high = P_BIGINT;
    while (low > BI_ONE) {
      const r2 = high / low;
      [lm, hm] = [hm - lm * r2, lm];
      [low, high] = [high - low * r2, low];
    }
    return biMod(lm);
  };
  var biModSqr = (a) => biModMul(a, a);
  var biModPow = (base, exp) => {
    let result = 1n;
    base = biMod(base);
    while (exp > 0n) {
      if ((exp & 1n) !== 0n) {
        result = biModMul(result, base);
      }
      base = biModMul(base, base);
      exp >>= 1n;
    }
    return result;
  };
  var P_PLUS1_DIV4 = P_BIGINT + 1n >> 2n;
  var biModSqrt = (a) => {
    const r2 = biModPow(a, P_PLUS1_DIV4);
    if (biModMul(r2, r2) !== biMod(a)) {
      return null;
    }
    return r2;
  };
  var toBigInt = (x) => {
    if (BigNumber.isBN(x))
      return BigInt("0x" + x.toString(16));
    if (typeof x === "string")
      return BigInt("0x" + x);
    if (Array.isArray(x))
      return BigInt("0x" + toHex(x));
    return BigInt(x);
  };
  var GX_BIGINT = BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  var GY_BIGINT = BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8");
  var WNAF_TABLE_CACHE = /* @__PURE__ */ new Map();
  var jpDouble = (P2) => {
    const { X: X1, Y: Y1, Z: Z1 } = P2;
    if (Y1 === BI_ZERO)
      return { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    const Y1sq = biModMul(Y1, Y1);
    const S = biModMul(BI_FOUR, biModMul(X1, Y1sq));
    const M = biModMul(BI_THREE, biModMul(X1, X1));
    const X3 = biModSub(biModMul(M, M), biModMul(BI_TWO, S));
    const Y3 = biModSub(biModMul(M, biModSub(S, X3)), biModMul(BI_EIGHT, biModMul(Y1sq, Y1sq)));
    const Z3 = biModMul(BI_TWO, biModMul(Y1, Z1));
    return { X: X3, Y: Y3, Z: Z3 };
  };
  var jpAdd = (P2, Q) => {
    if (P2.Z === BI_ZERO)
      return Q;
    if (Q.Z === BI_ZERO)
      return P2;
    const Z1Z1 = biModMul(P2.Z, P2.Z);
    const Z2Z2 = biModMul(Q.Z, Q.Z);
    const U1 = biModMul(P2.X, Z2Z2);
    const U2 = biModMul(Q.X, Z1Z1);
    const S1 = biModMul(P2.Y, biModMul(Z2Z2, Q.Z));
    const S2 = biModMul(Q.Y, biModMul(Z1Z1, P2.Z));
    const H = biModSub(U2, U1);
    const r2 = biModSub(S2, S1);
    if (H === BI_ZERO) {
      if (r2 === BI_ZERO)
        return jpDouble(P2);
      return { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    }
    const HH = biModMul(H, H);
    const HHH = biModMul(H, HH);
    const V = biModMul(U1, HH);
    const X3 = biModSub(biModSub(biModMul(r2, r2), HHH), biModMul(BI_TWO, V));
    const Y3 = biModSub(biModMul(r2, biModSub(V, X3)), biModMul(S1, HHH));
    const Z3 = biModMul(H, biModMul(P2.Z, Q.Z));
    return { X: X3, Y: Y3, Z: Z3 };
  };
  var jpNeg = (P2) => {
    if (P2.Z === BI_ZERO)
      return P2;
    return { X: P2.X, Y: P_BIGINT - P2.Y, Z: P2.Z };
  };
  var scalarMultiplyWNAF = (k, P0, window2 = 5) => {
    const key = `${window2}:${P0.x.toString(16)}:${P0.y.toString(16)}`;
    let tbl = WNAF_TABLE_CACHE.get(key);
    let P2;
    if (tbl === void 0) {
      const tblSize = 1 << window2 - 1;
      tbl = new Array(tblSize);
      P2 = { X: P0.x, Y: P0.y, Z: BI_ONE };
      tbl[0] = P2;
      const twoP = jpDouble(P2);
      for (let i = 1; i < tblSize; i++) {
        tbl[i] = jpAdd(tbl[i - 1], twoP);
      }
      WNAF_TABLE_CACHE.set(key, tbl);
    } else {
      P2 = tbl[0];
    }
    const wnaf = [];
    const wBig = 1n << BigInt(window2);
    const wHalf = wBig >> 1n;
    let kTmp = k;
    while (kTmp > 0n) {
      if ((kTmp & BI_ONE) === BI_ZERO) {
        wnaf.push(0);
        kTmp >>= BI_ONE;
      } else {
        let z = kTmp & wBig - 1n;
        if (z > wHalf)
          z -= wBig;
        wnaf.push(Number(z));
        kTmp -= z;
        kTmp >>= BI_ONE;
      }
    }
    let Q = { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    for (let i = wnaf.length - 1; i >= 0; i--) {
      Q = jpDouble(Q);
      const di = wnaf[i];
      if (di !== 0) {
        const idx = Math.abs(di) >> 1;
        const addend = di > 0 ? tbl[idx] : jpNeg(tbl[idx]);
        Q = jpAdd(Q, addend);
      }
    }
    return Q;
  };
  var modN = (a) => {
    let r2 = a % N_BIGINT;
    if (r2 < 0n)
      r2 += N_BIGINT;
    return r2;
  };
  var modMulN = (a, b) => modN(a * b);
  var modInvN = (a) => {
    let lm = 1n;
    let hm = 0n;
    let low = modN(a);
    let high = N_BIGINT;
    while (low > 1n) {
      const q = high / low;
      [lm, hm] = [hm - lm * q, lm];
      [low, high] = [high - low * q, low];
    }
    return modN(lm);
  };
  var Point = class _Point extends BasePoint {
    /**
     * @constructor
     * @param x - The x-coordinate of the point. May be a number, a BigNumber, a string (which will be interpreted as hex), a number array, or null. If null, an "Infinity" point is constructed.
     * @param y - The y-coordinate of the point, similar to x.
     * @param isRed - A boolean indicating if the point is a member of the field of integers modulo the k256 prime. Default is true.
     *
     * @example
     * new Point('abc123', 'def456');
     * new Point(null, null); // Generates Infinity point.
     */
    constructor(x, y, isRed = true) {
      super("affine");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "inf");
      this.precomputed = null;
      if (x === null && y === null) {
        this.x = null;
        this.y = null;
        this.inf = true;
      } else {
        if (!BigNumber.isBN(x)) {
          x = new BigNumber(x, 16);
        }
        this.x = x;
        if (!BigNumber.isBN(y)) {
          y = new BigNumber(y, 16);
        }
        this.y = y;
        if (isRed) {
          this.x.forceRed(this.curve.red);
          this.y.forceRed(this.curve.red);
        }
        if (this.x.red === null) {
          this.x = this.x.toRed(this.curve.red);
        }
        if (this.y.red === null) {
          this.y = this.y.toRed(this.curve.red);
        }
        this.inf = false;
      }
    }
    static _assertOnCurve(p) {
      if (!p.validate()) {
        throw new Error("Invalid point");
      }
      return p;
    }
    /**
     * Creates a point object from a given Array. These numbers can represent coordinates in hex format, or points
     * in multiple established formats.
     * The function verifies the integrity of the provided data and throws errors if inconsistencies are found.
     *
     * @method fromDER
     * @static
     * @param bytes - The point representation number array.
     * @returns Returns a new point representing the given string.
     * @throws `Error` If the point number[] value has a wrong length.
     * @throws `Error` If the point format is unknown.
     *
     * @example
     * const derPoint = [ 2, 18, 123, 108, 125, 83, 1, 251, 164, 214, 16, 119, 200, 216, 210, 193, 251, 193, 129, 67, 97, 146, 210, 216, 77, 254, 18, 6, 150, 190, 99, 198, 128 ];
     * const point = Point.fromDER(derPoint);
     */
    static fromDER(bytes2) {
      const len = 32;
      if ((bytes2[0] === 4 || bytes2[0] === 6 || bytes2[0] === 7) && bytes2.length - 1 === 2 * len) {
        if (bytes2[0] === 6) {
          if (bytes2[bytes2.length - 1] % 2 !== 0) {
            throw new Error("Point string value is wrong length");
          }
        } else if (bytes2[0] === 7) {
          if (bytes2[bytes2.length - 1] % 2 !== 1) {
            throw new Error("Point string value is wrong length");
          }
        }
        const res = new _Point(bytes2.slice(1, 1 + len), bytes2.slice(1 + len, 1 + 2 * len));
        return _Point._assertOnCurve(res);
      } else if ((bytes2[0] === 2 || bytes2[0] === 3) && bytes2.length - 1 === len) {
        return _Point._assertOnCurve(_Point.fromX(bytes2.slice(1, 1 + len), bytes2[0] === 3));
      }
      throw new Error("Unknown point format");
    }
    /**
     * Creates a point object from a given string. This string can represent coordinates in hex format, or points
     * in multiple established formats.
     * The function verifies the integrity of the provided data and throws errors if inconsistencies are found.
     *
     * @method fromString
     * @static
     *
     * @param str The point representation string.
     * @returns Returns a new point representing the given string.
     * @throws `Error` If the point string value has a wrong length.
     * @throws `Error` If the point format is unknown.
     *
     * @example
     * const pointStr = 'abcdef';
     * const point = Point.fromString(pointStr);
     */
    static fromString(str) {
      const bytes2 = toArray2(str, "hex");
      return _Point._assertOnCurve(_Point.fromDER(bytes2));
    }
    /**
     * Generates a point from an x coordinate and a boolean indicating whether the corresponding
     * y coordinate is odd.
     *
     * @method fromX
     * @static
     * @param x - The x coordinate of the point.
     * @param odd - Boolean indicating whether the corresponding y coordinate is odd or not.
     * @returns Returns the new point.
     * @throws `Error` If the point is invalid.
     *
     * @example
     * const xCoordinate = new BigNumber('10');
     * const point = Point.fromX(xCoordinate, true);
     */
    static fromX(x, odd) {
      let xBigInt = toBigInt(x);
      xBigInt = biMod(xBigInt);
      const y2 = biModAdd(biModMul(biModSqr(xBigInt), xBigInt), 7n);
      const y = biModSqrt(y2);
      if (y === null) {
        throw new Error("Invalid point");
      }
      let yBig = y;
      if ((yBig & BI_ONE) !== (odd ? BI_ONE : BI_ZERO)) {
        yBig = biModSub(P_BIGINT, yBig);
      }
      const xBN = new BigNumber(xBigInt.toString(16), 16);
      const yBN = new BigNumber(yBig.toString(16), 16);
      return _Point._assertOnCurve(new _Point(xBN, yBN));
    }
    /**
     * Generates a point from a serialized JSON object. The function accounts for different options in the JSON object,
     * including precomputed values for optimization of EC operations, and calls another helper function to turn nested
     * JSON points into proper Point objects.
     *
     * @method fromJSON
     * @static
     * @param obj - An object or array that holds the data for the point.
     * @param isRed - A boolean to direct how the Point is constructed from the JSON object.
     * @returns Returns a new point based on the deserialized JSON object.
     *
     * @example
     * const serializedPoint = '{"x":52,"y":15}';
     * const point = Point.fromJSON(serializedPoint, true);
     */
    static fromJSON(obj, isRed) {
      if (typeof obj === "string") {
        obj = JSON.parse(obj);
      }
      let res = new _Point(obj[0], obj[1], isRed);
      res = _Point._assertOnCurve(res);
      if (typeof obj[2] !== "object" || obj[2] === null) {
        return res;
      }
      const pre = obj[2];
      const obj2point = (p) => {
        const pt = new _Point(p[0], p[1], isRed);
        return _Point._assertOnCurve(pt);
      };
      res.precomputed = {
        beta: null,
        doubles: typeof pre.doubles === "object" && pre.doubles !== null ? {
          step: pre.doubles.step,
          points: [res].concat(pre.doubles.points.map(obj2point))
        } : void 0,
        naf: typeof pre.naf === "object" && pre.naf !== null ? {
          wnd: pre.naf.wnd,
          points: [res].concat(pre.naf.points.map(obj2point))
        } : void 0
      };
      return res;
    }
    /**
     * Validates if a point belongs to the curve. Follows the short Weierstrass
     * equation for elliptic curves: y^2 = x^3 + ax + b.
     *
     * @method validate
     * @returns {boolean} true if the point is on the curve, false otherwise.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const isValid = aPoint.validate();
     */
    validate() {
      if (this.inf || this.x == null || this.y == null)
        return false;
      try {
        const xBig = BigInt("0x" + this.x.fromRed().toString(16));
        const yBig = BigInt("0x" + this.y.fromRed().toString(16));
        const lhs = biModMul(yBig, yBig);
        const rhs = biModAdd(biModMul(biModMul(xBig, xBig), xBig), 7n);
        return lhs === rhs;
      } catch {
        return false;
      }
    }
    /**
     * Encodes the coordinates of a point into an array or a hexadecimal string.
     * The details of encoding are determined by the optional compact and enc parameters.
     *
     * @method encode
     * @param compact - If true, an additional prefix byte 0x02 or 0x03 based on the 'y' coordinate being even or odd respectively is used. If false, byte 0x04 is used.
     * @param enc - Expects the string 'hex' if hexadecimal string encoding is required instead of an array of numbers.
     * @throws Will throw an error if the specified encoding method is not recognized. Expects 'hex'.
     * @returns If enc is undefined, a byte array representation of the point will be returned. if enc is 'hex', a hexadecimal string representation of the point will be returned.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const encodedPointArray = aPoint.encode();
     * const encodedPointHex = aPoint.encode(true, 'hex');
     */
    encode(compact = true, enc) {
      if (this.inf) {
        if (enc === "hex")
          return "00";
        return [0];
      }
      const len = this.curve.p.byteLength();
      const x = this.getX().toArray("be", len);
      let res;
      if (compact) {
        res = [this.getY().isEven() ? 2 : 3].concat(x);
      } else {
        res = [4].concat(x, this.getY().toArray("be", len));
      }
      if (enc !== "hex") {
        return res;
      } else {
        return toHex(res);
      }
    }
    /**
     * Converts the point coordinates to a hexadecimal string. A wrapper method
     * for encode. Byte 0x02 or 0x03 is used as prefix based on the 'y' coordinate being even or odd respectively.
     *
     * @method toString
     * @returns {string} A hexadecimal string representation of the point coordinates.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const stringPoint = aPoint.toString();
     */
    toString() {
      return this.encode(true, "hex");
    }
    /**
     * Exports the x and y coordinates of the point, and the precomputed doubles and non-adjacent form (NAF) for optimization. The output is an array.
     *
     * @method toJSON
     * @returns An Array where first two elements are the coordinates of the point and optional third element is an object with doubles and NAF points.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const jsonPoint = aPoint.toJSON();
     */
    toJSON() {
      if (this.precomputed == null) {
        return [this.x, this.y];
      }
      return [
        this.x,
        this.y,
        typeof this.precomputed === "object" && this.precomputed !== null ? {
          doubles: this.precomputed.doubles != null ? {
            step: this.precomputed.doubles.step,
            points: this.precomputed.doubles.points.slice(1)
          } : void 0,
          naf: this.precomputed.naf != null ? {
            wnd: this.precomputed.naf.wnd,
            points: this.precomputed.naf.points.slice(1)
          } : void 0
        } : void 0
      ];
    }
    /**
     * Provides the point coordinates in a human-readable string format for debugging purposes.
     *
     * @method inspect
     * @returns String of the format '<EC Point x: x-coordinate y: y-coordinate>', or '<EC Point Infinity>' if the point is at infinity.
     *
     * @example
     * const aPoint = new Point(x, y);
     * console.log(aPoint.inspect());
     */
    inspect() {
      if (this.isInfinity()) {
        return "<EC Point Infinity>";
      }
      return "<EC Point x: " + (this.x?.fromRed()?.toString(16, 2) ?? "undefined") + " y: " + (this.y?.fromRed()?.toString(16, 2) ?? "undefined") + ">";
    }
    /**
     * Checks if the point is at infinity.
     * @method isInfinity
     * @returns Returns whether or not the point is at infinity.
     *
     * @example
     * const p = new Point(null, null);
     * console.log(p.isInfinity()); // outputs: true
     */
    isInfinity() {
      return this.inf;
    }
    /**
     * Adds another Point to this Point, returning a new Point.
     *
     * @method add
     * @param p - The Point to add to this one.
     * @returns A new Point that results from the addition.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.add(p2);
     */
    add(p) {
      if (this.inf) {
        return p;
      }
      if (p.inf) {
        return this;
      }
      if (this.eq(p)) {
        return this.dbl();
      }
      if (this.neg().eq(p)) {
        return new _Point(null, null);
      }
      if (this.x?.cmp(p.x ?? new BigNumber(0)) === 0) {
        return new _Point(null, null);
      }
      const P1 = {
        X: BigInt("0x" + this.x.fromRed().toString(16)),
        Y: BigInt("0x" + this.y.fromRed().toString(16)),
        Z: BI_ONE
      };
      const Q1 = {
        X: BigInt("0x" + p.x.fromRed().toString(16)),
        Y: BigInt("0x" + p.y.fromRed().toString(16)),
        Z: BI_ONE
      };
      const R2 = jpAdd(P1, Q1);
      if (R2.Z === BI_ZERO)
        return new _Point(null, null);
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      return new _Point(xRes.toString(16), yRes.toString(16));
    }
    /**
     * Doubles the current point.
     *
     * @method dbl
     *
     * @example
     * const P = new Point('123', '456');
     * const result = P.dbl();
     * */
    dbl() {
      if (this.inf)
        return this;
      if (this.x === null || this.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const X = BigInt("0x" + this.x.fromRed().toString(16));
      const Y = BigInt("0x" + this.y.fromRed().toString(16));
      if (Y === BI_ZERO)
        return new _Point(null, null);
      const R2 = jpDouble({ X, Y, Z: BI_ONE });
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      return new _Point(xRes.toString(16), yRes.toString(16));
    }
    /**
     * Returns X coordinate of point
     *
     * @example
     * const P = new Point('123', '456');
     * const x = P.getX();
     */
    getX() {
      return (this.x ?? new BigNumber(0)).fromRed();
    }
    /**
     * Returns X coordinate of point
     *
     * @example
     * const P = new Point('123', '456');
     * const x = P.getX();
     */
    getY() {
      return (this.y ?? new BigNumber(0)).fromRed();
    }
    /**
     * Multiplies this Point by a scalar value, returning a new Point.
     *
     * @method mul
     * @param k - The scalar value to multiply this Point by.
     * @returns  A new Point that results from the multiplication.
     *
     * @example
     * const p = new Point(1, 2);
     * const result = p.mul(2); // this doubles the Point
     */
    mul(k) {
      if (!BigNumber.isBN(k)) {
        k = new BigNumber(k, 16);
      }
      k = k;
      if (this.inf) {
        return this;
      }
      const isNeg = k.isNeg();
      const kAbs = isNeg ? k.neg() : k;
      let kBig = BigInt("0x" + kAbs.toString(16));
      kBig = biMod(kBig);
      if (kBig === BI_ZERO) {
        return new _Point(null, null);
      }
      if (kBig === BI_ZERO) {
        return new _Point(null, null);
      }
      if (this.x === null || this.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      let Px;
      let Py;
      if (this === this.curve.g) {
        Px = GX_BIGINT;
        Py = GY_BIGINT;
      } else {
        Px = BigInt("0x" + this.x.fromRed().toString(16));
        Py = BigInt("0x" + this.y.fromRed().toString(16));
      }
      const R2 = scalarMultiplyWNAF(kBig, { x: Px, y: Py });
      if (R2.Z === BI_ZERO) {
        return new _Point(null, null);
      }
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      const xBN = new BigNumber(xRes.toString(16), 16);
      const yBN = new BigNumber(yRes.toString(16), 16);
      const result = new _Point(xBN, yBN);
      if (isNeg) {
        return result.neg();
      }
      return result;
    }
    mulCT(k) {
      if (!BigNumber.isBN(k)) {
        k = new BigNumber(k, 16);
      }
      k = k;
      if (this.inf)
        return new _Point(null, null);
      const isNeg = k.isNeg();
      const kAbs = isNeg ? k.neg() : k;
      let kBig = BigInt("0x" + kAbs.toString(16));
      kBig = biMod(kBig);
      if (kBig === 0n)
        return new _Point(null, null);
      const Px = this === this.curve.g ? GX_BIGINT : BigInt("0x" + this.getX().toString(16));
      const Py = this === this.curve.g ? GY_BIGINT : BigInt("0x" + this.getY().toString(16));
      let R0 = { X: 0n, Y: 1n, Z: 0n };
      let R1 = { X: Px, Y: Py, Z: 1n };
      const bits = kBig.toString(2);
      for (let i = 0; i < bits.length; i++) {
        const bit = bits[i] === "1" ? 1n : 0n;
        ctSwap(bit, R0, R1);
        R1 = jpAdd(R0, R1);
        R0 = jpDouble(R0);
        ctSwap(bit, R0, R1);
      }
      if (R0.Z === 0n)
        return new _Point(null, null);
      const zInv = biModInv(R0.Z);
      const zInv2 = biModMul(zInv, zInv);
      const x = biModMul(R0.X, zInv2);
      const y = biModMul(R0.Y, biModMul(zInv2, zInv));
      const result = new _Point(x.toString(16), y.toString(16));
      return isNeg ? result.neg() : result;
    }
    /**
     * Performs a multiplication and addition operation in a single step.
     * Multiplies this Point by k1, adds the resulting Point to the result of p2 multiplied by k2.
     *
     * @method mulAdd
     * @param k1 - The scalar value to multiply this Point by.
     * @param p2 - The other Point to be involved in the operation.
     * @param k2 - The scalar value to multiply the Point p2 by.
     * @returns A Point that results from the combined multiplication and addition operations.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.mulAdd(2, p2, 3);
     */
    mulAdd(k1, p2, k2) {
      const points = [this, p2];
      const coeffs = [k1, k2];
      return this._endoWnafMulAdd(points, coeffs);
    }
    /**
     * Performs the Jacobian multiplication and addition operation in a single
     * step. Instead of returning a regular Point, the result is a JacobianPoint.
     *
     * @method jmulAdd
     * @param k1 - The scalar value to multiply this Point by.
     * @param p2 - The other Point to be involved in the operation
     * @param k2 - The scalar value to multiply the Point p2 by.
     * @returns A JacobianPoint that results from the combined multiplication and addition operation.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.jmulAdd(2, p2, 3);
     */
    jmulAdd(k1, p2, k2) {
      const points = [this, p2];
      const coeffs = [k1, k2];
      return this._endoWnafMulAdd(points, coeffs, true);
    }
    /**
     * Checks if the Point instance is equal to another given Point.
     *
     * @method eq
     * @param p - The Point to be checked if equal to the current instance.
     *
     * @returns Whether the two Point instances are equal. Both the 'x' and 'y' coordinates have to match, and both points have to either be valid or at infinity for equality. If both conditions are true, it returns true, else it returns false.
     *
     * @example
     * const p1 = new Point(5, 20);
     * const p2 = new Point(5, 20);
     * const areEqual = p1.eq(p2); // returns true
     */
    eq(p) {
      return this === p || this.inf === p.inf && (this.inf || (this.x ?? new BigNumber(0)).cmp(p.x ?? new BigNumber(0)) === 0 && (this.y ?? new BigNumber(0)).cmp(p.y ?? new BigNumber(0)) === 0);
    }
    /**
     * Negate a point. The negation of a point P is the mirror of P about x-axis.
     *
     * @method neg
     *
     * @example
     * const P = new Point('123', '456');
     * const result = P.neg();
     */
    neg(_precompute) {
      if (this.inf) {
        return this;
      }
      const res = new _Point(this.x, (this.y ?? new BigNumber(0)).redNeg());
      if (_precompute === true && this.precomputed != null) {
        const pre = this.precomputed;
        const negate = (p) => p.neg();
        res.precomputed = {
          naf: pre.naf != null ? {
            wnd: pre.naf.wnd,
            points: pre.naf.points.map(negate)
          } : void 0,
          doubles: pre.doubles != null ? {
            step: pre.doubles.step,
            points: pre.doubles.points.map((p) => p.neg())
          } : void 0,
          beta: void 0
        };
      }
      return res;
    }
    /**
     * Performs the "doubling" operation on the Point a given number of times.
     * This is used in elliptic curve operations to perform multiplication by 2, multiple times.
     * If the point is at infinity, it simply returns the point because doubling
     * a point at infinity is still infinity.
     *
     * @method dblp
     * @param k - The number of times the "doubling" operation is to be performed on the Point.
     * @returns The Point after 'k' "doubling" operations have been performed.
     *
     * @example
     * const p = new Point(5, 20);
     * const doubledPoint = p.dblp(10); // returns the point after "doubled" 10 times
     */
    dblp(k) {
      let r2 = this;
      for (let i = 0; i < k; i++) {
        r2 = r2.dbl();
      }
      return r2;
    }
    /**
     * Converts the point to a Jacobian point. If the point is at infinity, the corresponding Jacobian point
     * will also be at infinity.
     *
     * @method toJ
     * @returns Returns a new Jacobian point based on the current point.
     *
     * @example
     * const point = new Point(xCoordinate, yCoordinate);
     * const jacobianPoint = point.toJ();
     */
    toJ() {
      if (this.inf) {
        return new JacobianPoint(null, null, null);
      }
      const res = new JacobianPoint(this.x, this.y, this.curve.one);
      return res;
    }
    _getBeta() {
      if (typeof this.curve.endo !== "object") {
        return;
      }
      const pre = this.precomputed;
      if (typeof pre === "object" && pre !== null && typeof pre.beta === "object" && pre.beta !== null) {
        return pre.beta;
      }
      const beta = new _Point((this.x ?? new BigNumber(0)).redMul(this.curve.endo.beta), this.y);
      if (pre != null) {
        const curve2 = this.curve;
        const endoMul = (p) => {
          if (p.x === null) {
            throw new Error("p.x is null");
          }
          if (curve2.endo === void 0 || curve2.endo === null) {
            throw new Error("curve.endo is undefined");
          }
          return new _Point(p.x.redMul(curve2.endo.beta), p.y);
        };
        pre.beta = beta;
        beta.precomputed = {
          beta: null,
          naf: pre.naf != null ? {
            wnd: pre.naf.wnd,
            points: pre.naf.points.map(endoMul)
          } : void 0,
          doubles: pre.doubles != null ? {
            step: pre.doubles.step,
            points: pre.doubles.points.map(endoMul)
          } : void 0
        };
      }
      return beta;
    }
    _fixedNafMul(k) {
      if (typeof this.precomputed !== "object" || this.precomputed === null) {
        throw new Error("_fixedNafMul requires precomputed values for the point");
      }
      const doubles = this._getDoubles();
      const naf = this.curve.getNAF(k, 1, this.curve._bitLength);
      let I = (1 << doubles.step + 1) - (doubles.step % 2 === 0 ? 2 : 1);
      I /= 3;
      const repr = [];
      for (let j = 0; j < naf.length; j += doubles.step) {
        let nafW = 0;
        for (let k2 = j + doubles.step - 1; k2 >= j; k2--) {
          nafW = (nafW << 1) + naf[k2];
        }
        repr.push(nafW);
      }
      let a = new JacobianPoint(null, null, null);
      let b = new JacobianPoint(null, null, null);
      for (let i = I; i > 0; i--) {
        for (let j = 0; j < repr.length; j++) {
          const nafW = repr[j];
          if (nafW === i) {
            b = b.mixedAdd(doubles.points[j]);
          } else if (nafW === -i) {
            b = b.mixedAdd(doubles.points[j].neg());
          }
        }
        a = a.add(b);
      }
      return a.toP();
    }
    _wnafMulAdd(defW, points, coeffs, len, jacobianResult) {
      const wndWidth = this.curve._wnafT1.map((num) => num.toNumber());
      const wnd = this.curve._wnafT2.map(() => []);
      const naf = this.curve._wnafT3.map(() => []);
      let max = 0;
      for (let i = 0; i < len; i++) {
        const p = points[i];
        const nafPoints = p._getNAFPoints(defW);
        wndWidth[i] = nafPoints.wnd;
        wnd[i] = nafPoints.points;
      }
      for (let i = len - 1; i >= 1; i -= 2) {
        const a = i - 1;
        const b = i;
        if (wndWidth[a] !== 1 || wndWidth[b] !== 1) {
          naf[a] = this.curve.getNAF(coeffs[a], wndWidth[a], this.curve._bitLength);
          naf[b] = this.curve.getNAF(coeffs[b], wndWidth[b], this.curve._bitLength);
          max = Math.max(naf[a].length, max);
          max = Math.max(naf[b].length, max);
          continue;
        }
        const comb = [
          points[a],
          null,
          null,
          points[b]
          /* 7 */
        ];
        if ((points[a].y ?? new BigNumber(0)).cmp(points[b].y ?? new BigNumber(0)) === 0) {
          comb[1] = points[a].add(points[b]);
          comb[2] = points[a].toJ().mixedAdd(points[b].neg());
        } else if ((points[a].y ?? new BigNumber(0)).cmp((points[b].y ?? new BigNumber(0)).redNeg()) === 0) {
          comb[1] = points[a].toJ().mixedAdd(points[b]);
          comb[2] = points[a].add(points[b].neg());
        } else {
          comb[1] = points[a].toJ().mixedAdd(points[b]);
          comb[2] = points[a].toJ().mixedAdd(points[b].neg());
        }
        const index = [
          -3,
          -1,
          -5,
          -7,
          0,
          7,
          5,
          1,
          3
          /* 1 1 */
        ];
        const jsf = this.curve.getJSF(coeffs[a], coeffs[b]);
        max = Math.max(jsf[0].length, max);
        naf[a] = new Array(max);
        naf[b] = new Array(max);
        for (let j = 0; j < max; j++) {
          const ja = jsf[0][j] | 0;
          const jb = jsf[1][j] | 0;
          naf[a][j] = index[(ja + 1) * 3 + (jb + 1)];
          naf[b][j] = 0;
          wnd[a] = comb;
        }
      }
      let acc = new JacobianPoint(null, null, null);
      const tmp = this.curve._wnafT4;
      for (let i = max; i >= 0; i--) {
        let k = 0;
        while (i >= 0) {
          let zero = true;
          for (let j = 0; j < len; j++) {
            tmp[j] = new BigNumber(typeof naf[j][i] === "number" ? naf[j][i] : 0);
            if (!tmp[j].isZero()) {
              zero = false;
            }
          }
          if (!zero) {
            break;
          }
          k++;
          i--;
        }
        if (i >= 0) {
          k++;
        }
        acc = acc.dblp(k);
        if (i < 0) {
          break;
        }
        const one = new BigNumber(1);
        const two = new BigNumber(2);
        for (let j = 0; j < len; j++) {
          const z = tmp[j];
          let p;
          if (z.cmpn(0) === 0) {
            continue;
          } else if (!z.isNeg()) {
            p = wnd[j][z.sub(one).div(two).toNumber()];
          } else {
            p = wnd[j][z.neg().sub(one).div(two).toNumber()].neg();
          }
          if (p.type === "affine") {
            acc = acc.mixedAdd(p);
          } else {
            acc = acc.add(p);
          }
        }
      }
      for (let i = 0; i < len; i++) {
        wnd[i] = [];
      }
      if (jacobianResult === true) {
        return acc;
      } else {
        return acc.toP();
      }
    }
    _endoWnafMulAdd(points, coeffs, jacobianResult) {
      const npoints = new Array(points.length * 2);
      const ncoeffs = new Array(points.length * 2);
      let i;
      for (i = 0; i < points.length; i++) {
        const split2 = this.curve._endoSplit(coeffs[i]);
        let p = points[i];
        let beta = p._getBeta() ?? new _Point(null, null);
        if (split2.k1.negative !== 0) {
          split2.k1.ineg();
          p = p.neg(true);
        }
        if (split2.k2.negative !== 0) {
          split2.k2.ineg();
          beta = beta.neg(true);
        }
        npoints[i * 2] = p;
        npoints[i * 2 + 1] = beta;
        ncoeffs[i * 2] = split2.k1;
        ncoeffs[i * 2 + 1] = split2.k2;
      }
      const res = this._wnafMulAdd(1, npoints, ncoeffs, i * 2, jacobianResult);
      for (let j = 0; j < i * 2; j++) {
        npoints[j] = null;
        ncoeffs[j] = null;
      }
      return res;
    }
    _hasDoubles(k) {
      if (this.precomputed == null) {
        return false;
      }
      const doubles = this.precomputed.doubles;
      if (typeof doubles !== "object") {
        return false;
      }
      return doubles.points.length >= Math.ceil((k.bitLength() + 1) / doubles.step);
    }
    _getDoubles(step, power) {
      if (typeof this.precomputed === "object" && this.precomputed !== null && typeof this.precomputed.doubles === "object" && this.precomputed.doubles !== null) {
        return this.precomputed.doubles;
      }
      const doubles = [this];
      let acc = this;
      for (let i = 0; i < (power ?? 0); i += step ?? 1) {
        for (let j = 0; j < (step ?? 1); j++) {
          acc = acc.dbl();
        }
        doubles.push(acc);
      }
      return {
        step: step ?? 1,
        points: doubles
      };
    }
    _getNAFPoints(wnd) {
      if (typeof this.precomputed === "object" && this.precomputed !== null && typeof this.precomputed.naf === "object" && this.precomputed.naf !== null) {
        return this.precomputed.naf;
      }
      const res = [this];
      const max = (1 << wnd) - 1;
      const dbl = max === 1 ? null : this.dbl();
      for (let i = 1; i < max; i++) {
        if (dbl !== null) {
          res[i] = res[i - 1].add(dbl);
        }
      }
      return {
        wnd,
        points: res
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Curve.js
  var globalCurve;
  var Curve = class _Curve {
    constructor() {
      __publicField(this, "p");
      __publicField(this, "red");
      __publicField(this, "redN");
      __publicField(this, "zero");
      __publicField(this, "one");
      __publicField(this, "two");
      __publicField(this, "g");
      __publicField(this, "n");
      __publicField(this, "a");
      __publicField(this, "b");
      __publicField(this, "tinv");
      __publicField(this, "zeroA");
      __publicField(this, "threeA");
      __publicField(this, "endo");
      // beta, lambda, basis
      __publicField(this, "_endoWnafT1");
      __publicField(this, "_endoWnafT2");
      __publicField(this, "_wnafT1");
      __publicField(this, "_wnafT2");
      __publicField(this, "_wnafT3");
      __publicField(this, "_wnafT4");
      __publicField(this, "_bitLength");
      if (typeof globalCurve !== "undefined") {
        return globalCurve;
      } else {
        globalCurve = this;
      }
      const precomputed = {
        doubles: {
          step: 4,
          points: [
            [
              "e60fce93b59e9ec53011aabc21c23e97b2a31369b87a5ae9c44ee89e2a6dec0a",
              "f7e3507399e595929db99f34f57937101296891e44d23f0be1f32cce69616821"
            ],
            [
              "8282263212c609d9ea2a6e3e172de238d8c39cabd5ac1ca10646e23fd5f51508",
              "11f8a8098557dfe45e8256e830b60ace62d613ac2f7b17bed31b6eaff6e26caf"
            ],
            [
              "175e159f728b865a72f99cc6c6fc846de0b93833fd2222ed73fce5b551e5b739",
              "d3506e0d9e3c79eba4ef97a51ff71f5eacb5955add24345c6efa6ffee9fed695"
            ],
            [
              "363d90d447b00c9c99ceac05b6262ee053441c7e55552ffe526bad8f83ff4640",
              "4e273adfc732221953b445397f3363145b9a89008199ecb62003c7f3bee9de9"
            ],
            [
              "8b4b5f165df3c2be8c6244b5b745638843e4a781a15bcd1b69f79a55dffdf80c",
              "4aad0a6f68d308b4b3fbd7813ab0da04f9e336546162ee56b3eff0c65fd4fd36"
            ],
            [
              "723cbaa6e5db996d6bf771c00bd548c7b700dbffa6c0e77bcb6115925232fcda",
              "96e867b5595cc498a921137488824d6e2660a0653779494801dc069d9eb39f5f"
            ],
            [
              "eebfa4d493bebf98ba5feec812c2d3b50947961237a919839a533eca0e7dd7fa",
              "5d9a8ca3970ef0f269ee7edaf178089d9ae4cdc3a711f712ddfd4fdae1de8999"
            ],
            [
              "100f44da696e71672791d0a09b7bde459f1215a29b3c03bfefd7835b39a48db0",
              "cdd9e13192a00b772ec8f3300c090666b7ff4a18ff5195ac0fbd5cd62bc65a09"
            ],
            [
              "e1031be262c7ed1b1dc9227a4a04c017a77f8d4464f3b3852c8acde6e534fd2d",
              "9d7061928940405e6bb6a4176597535af292dd419e1ced79a44f18f29456a00d"
            ],
            [
              "feea6cae46d55b530ac2839f143bd7ec5cf8b266a41d6af52d5e688d9094696d",
              "e57c6b6c97dce1bab06e4e12bf3ecd5c981c8957cc41442d3155debf18090088"
            ],
            [
              "da67a91d91049cdcb367be4be6ffca3cfeed657d808583de33fa978bc1ec6cb1",
              "9bacaa35481642bc41f463f7ec9780e5dec7adc508f740a17e9ea8e27a68be1d"
            ],
            [
              "53904faa0b334cdda6e000935ef22151ec08d0f7bb11069f57545ccc1a37b7c0",
              "5bc087d0bc80106d88c9eccac20d3c1c13999981e14434699dcb096b022771c8"
            ],
            [
              "8e7bcd0bd35983a7719cca7764ca906779b53a043a9b8bcaeff959f43ad86047",
              "10b7770b2a3da4b3940310420ca9514579e88e2e47fd68b3ea10047e8460372a"
            ],
            [
              "385eed34c1cdff21e6d0818689b81bde71a7f4f18397e6690a841e1599c43862",
              "283bebc3e8ea23f56701de19e9ebf4576b304eec2086dc8cc0458fe5542e5453"
            ],
            [
              "6f9d9b803ecf191637c73a4413dfa180fddf84a5947fbc9c606ed86c3fac3a7",
              "7c80c68e603059ba69b8e2a30e45c4d47ea4dd2f5c281002d86890603a842160"
            ],
            [
              "3322d401243c4e2582a2147c104d6ecbf774d163db0f5e5313b7e0e742d0e6bd",
              "56e70797e9664ef5bfb019bc4ddaf9b72805f63ea2873af624f3a2e96c28b2a0"
            ],
            [
              "85672c7d2de0b7da2bd1770d89665868741b3f9af7643397721d74d28134ab83",
              "7c481b9b5b43b2eb6374049bfa62c2e5e77f17fcc5298f44c8e3094f790313a6"
            ],
            [
              "948bf809b1988a46b06c9f1919413b10f9226c60f668832ffd959af60c82a0a",
              "53a562856dcb6646dc6b74c5d1c3418c6d4dff08c97cd2bed4cb7f88d8c8e589"
            ],
            [
              "6260ce7f461801c34f067ce0f02873a8f1b0e44dfc69752accecd819f38fd8e8",
              "bc2da82b6fa5b571a7f09049776a1ef7ecd292238051c198c1a84e95b2b4ae17"
            ],
            [
              "e5037de0afc1d8d43d8348414bbf4103043ec8f575bfdc432953cc8d2037fa2d",
              "4571534baa94d3b5f9f98d09fb990bddbd5f5b03ec481f10e0e5dc841d755bda"
            ],
            [
              "e06372b0f4a207adf5ea905e8f1771b4e7e8dbd1c6a6c5b725866a0ae4fce725",
              "7a908974bce18cfe12a27bb2ad5a488cd7484a7787104870b27034f94eee31dd"
            ],
            [
              "213c7a715cd5d45358d0bbf9dc0ce02204b10bdde2a3f58540ad6908d0559754",
              "4b6dad0b5ae462507013ad06245ba190bb4850f5f36a7eeddff2c27534b458f2"
            ],
            [
              "4e7c272a7af4b34e8dbb9352a5419a87e2838c70adc62cddf0cc3a3b08fbd53c",
              "17749c766c9d0b18e16fd09f6def681b530b9614bff7dd33e0b3941817dcaae6"
            ],
            [
              "fea74e3dbe778b1b10f238ad61686aa5c76e3db2be43057632427e2840fb27b6",
              "6e0568db9b0b13297cf674deccb6af93126b596b973f7b77701d3db7f23cb96f"
            ],
            [
              "76e64113f677cf0e10a2570d599968d31544e179b760432952c02a4417bdde39",
              "c90ddf8dee4e95cf577066d70681f0d35e2a33d2b56d2032b4b1752d1901ac01"
            ],
            [
              "c738c56b03b2abe1e8281baa743f8f9a8f7cc643df26cbee3ab150242bcbb891",
              "893fb578951ad2537f718f2eacbfbbbb82314eef7880cfe917e735d9699a84c3"
            ],
            [
              "d895626548b65b81e264c7637c972877d1d72e5f3a925014372e9f6588f6c14b",
              "febfaa38f2bc7eae728ec60818c340eb03428d632bb067e179363ed75d7d991f"
            ],
            [
              "b8da94032a957518eb0f6433571e8761ceffc73693e84edd49150a564f676e03",
              "2804dfa44805a1e4d7c99cc9762808b092cc584d95ff3b511488e4e74efdf6e7"
            ],
            [
              "e80fea14441fb33a7d8adab9475d7fab2019effb5156a792f1a11778e3c0df5d",
              "eed1de7f638e00771e89768ca3ca94472d155e80af322ea9fcb4291b6ac9ec78"
            ],
            [
              "a301697bdfcd704313ba48e51d567543f2a182031efd6915ddc07bbcc4e16070",
              "7370f91cfb67e4f5081809fa25d40f9b1735dbf7c0a11a130c0d1a041e177ea1"
            ],
            [
              "90ad85b389d6b936463f9d0512678de208cc330b11307fffab7ac63e3fb04ed4",
              "e507a3620a38261affdcbd9427222b839aefabe1582894d991d4d48cb6ef150"
            ],
            [
              "8f68b9d2f63b5f339239c1ad981f162ee88c5678723ea3351b7b444c9ec4c0da",
              "662a9f2dba063986de1d90c2b6be215dbbea2cfe95510bfdf23cbf79501fff82"
            ],
            [
              "e4f3fb0176af85d65ff99ff9198c36091f48e86503681e3e6686fd5053231e11",
              "1e63633ad0ef4f1c1661a6d0ea02b7286cc7e74ec951d1c9822c38576feb73bc"
            ],
            [
              "8c00fa9b18ebf331eb961537a45a4266c7034f2f0d4e1d0716fb6eae20eae29e",
              "efa47267fea521a1a9dc343a3736c974c2fadafa81e36c54e7d2a4c66702414b"
            ],
            [
              "e7a26ce69dd4829f3e10cec0a9e98ed3143d084f308b92c0997fddfc60cb3e41",
              "2a758e300fa7984b471b006a1aafbb18d0a6b2c0420e83e20e8a9421cf2cfd51"
            ],
            [
              "b6459e0ee3662ec8d23540c223bcbdc571cbcb967d79424f3cf29eb3de6b80ef",
              "67c876d06f3e06de1dadf16e5661db3c4b3ae6d48e35b2ff30bf0b61a71ba45"
            ],
            [
              "d68a80c8280bb840793234aa118f06231d6f1fc67e73c5a5deda0f5b496943e8",
              "db8ba9fff4b586d00c4b1f9177b0e28b5b0e7b8f7845295a294c84266b133120"
            ],
            [
              "324aed7df65c804252dc0270907a30b09612aeb973449cea4095980fc28d3d5d",
              "648a365774b61f2ff130c0c35aec1f4f19213b0c7e332843967224af96ab7c84"
            ],
            [
              "4df9c14919cde61f6d51dfdbe5fee5dceec4143ba8d1ca888e8bd373fd054c96",
              "35ec51092d8728050974c23a1d85d4b5d506cdc288490192ebac06cad10d5d"
            ],
            [
              "9c3919a84a474870faed8a9c1cc66021523489054d7f0308cbfc99c8ac1f98cd",
              "ddb84f0f4a4ddd57584f044bf260e641905326f76c64c8e6be7e5e03d4fc599d"
            ],
            [
              "6057170b1dd12fdf8de05f281d8e06bb91e1493a8b91d4cc5a21382120a959e5",
              "9a1af0b26a6a4807add9a2daf71df262465152bc3ee24c65e899be932385a2a8"
            ],
            [
              "a576df8e23a08411421439a4518da31880cef0fba7d4df12b1a6973eecb94266",
              "40a6bf20e76640b2c92b97afe58cd82c432e10a7f514d9f3ee8be11ae1b28ec8"
            ],
            [
              "7778a78c28dec3e30a05fe9629de8c38bb30d1f5cf9a3a208f763889be58ad71",
              "34626d9ab5a5b22ff7098e12f2ff580087b38411ff24ac563b513fc1fd9f43ac"
            ],
            [
              "928955ee637a84463729fd30e7afd2ed5f96274e5ad7e5cb09eda9c06d903ac",
              "c25621003d3f42a827b78a13093a95eeac3d26efa8a8d83fc5180e935bcd091f"
            ],
            [
              "85d0fef3ec6db109399064f3a0e3b2855645b4a907ad354527aae75163d82751",
              "1f03648413a38c0be29d496e582cf5663e8751e96877331582c237a24eb1f962"
            ],
            [
              "ff2b0dce97eece97c1c9b6041798b85dfdfb6d8882da20308f5404824526087e",
              "493d13fef524ba188af4c4dc54d07936c7b7ed6fb90e2ceb2c951e01f0c29907"
            ],
            [
              "827fbbe4b1e880ea9ed2b2e6301b212b57f1ee148cd6dd28780e5e2cf856e241",
              "c60f9c923c727b0b71bef2c67d1d12687ff7a63186903166d605b68baec293ec"
            ],
            [
              "eaa649f21f51bdbae7be4ae34ce6e5217a58fdce7f47f9aa7f3b58fa2120e2b3",
              "be3279ed5bbbb03ac69a80f89879aa5a01a6b965f13f7e59d47a5305ba5ad93d"
            ],
            [
              "e4a42d43c5cf169d9391df6decf42ee541b6d8f0c9a137401e23632dda34d24f",
              "4d9f92e716d1c73526fc99ccfb8ad34ce886eedfa8d8e4f13a7f7131deba9414"
            ],
            [
              "1ec80fef360cbdd954160fadab352b6b92b53576a88fea4947173b9d4300bf19",
              "aeefe93756b5340d2f3a4958a7abbf5e0146e77f6295a07b671cdc1cc107cefd"
            ],
            [
              "146a778c04670c2f91b00af4680dfa8bce3490717d58ba889ddb5928366642be",
              "b318e0ec3354028add669827f9d4b2870aaa971d2f7e5ed1d0b297483d83efd0"
            ],
            [
              "fa50c0f61d22e5f07e3acebb1aa07b128d0012209a28b9776d76a8793180eef9",
              "6b84c6922397eba9b72cd2872281a68a5e683293a57a213b38cd8d7d3f4f2811"
            ],
            [
              "da1d61d0ca721a11b1a5bf6b7d88e8421a288ab5d5bba5220e53d32b5f067ec2",
              "8157f55a7c99306c79c0766161c91e2966a73899d279b48a655fba0f1ad836f1"
            ],
            [
              "a8e282ff0c9706907215ff98e8fd416615311de0446f1e062a73b0610d064e13",
              "7f97355b8db81c09abfb7f3c5b2515888b679a3e50dd6bd6cef7c73111f4cc0c"
            ],
            [
              "174a53b9c9a285872d39e56e6913cab15d59b1fa512508c022f382de8319497c",
              "ccc9dc37abfc9c1657b4155f2c47f9e6646b3a1d8cb9854383da13ac079afa73"
            ],
            [
              "959396981943785c3d3e57edf5018cdbe039e730e4918b3d884fdff09475b7ba",
              "2e7e552888c331dd8ba0386a4b9cd6849c653f64c8709385e9b8abf87524f2fd"
            ],
            [
              "d2a63a50ae401e56d645a1153b109a8fcca0a43d561fba2dbb51340c9d82b151",
              "e82d86fb6443fcb7565aee58b2948220a70f750af484ca52d4142174dcf89405"
            ],
            [
              "64587e2335471eb890ee7896d7cfdc866bacbdbd3839317b3436f9b45617e073",
              "d99fcdd5bf6902e2ae96dd6447c299a185b90a39133aeab358299e5e9faf6589"
            ],
            [
              "8481bde0e4e4d885b3a546d3e549de042f0aa6cea250e7fd358d6c86dd45e458",
              "38ee7b8cba5404dd84a25bf39cecb2ca900a79c42b262e556d64b1b59779057e"
            ],
            [
              "13464a57a78102aa62b6979ae817f4637ffcfed3c4b1ce30bcd6303f6caf666b",
              "69be159004614580ef7e433453ccb0ca48f300a81d0942e13f495a907f6ecc27"
            ],
            [
              "bc4a9df5b713fe2e9aef430bcc1dc97a0cd9ccede2f28588cada3a0d2d83f366",
              "d3a81ca6e785c06383937adf4b798caa6e8a9fbfa547b16d758d666581f33c1"
            ],
            [
              "8c28a97bf8298bc0d23d8c749452a32e694b65e30a9472a3954ab30fe5324caa",
              "40a30463a3305193378fedf31f7cc0eb7ae784f0451cb9459e71dc73cbef9482"
            ],
            [
              "8ea9666139527a8c1dd94ce4f071fd23c8b350c5a4bb33748c4ba111faccae0",
              "620efabbc8ee2782e24e7c0cfb95c5d735b783be9cf0f8e955af34a30e62b945"
            ],
            [
              "dd3625faef5ba06074669716bbd3788d89bdde815959968092f76cc4eb9a9787",
              "7a188fa3520e30d461da2501045731ca941461982883395937f68d00c644a573"
            ],
            [
              "f710d79d9eb962297e4f6232b40e8f7feb2bc63814614d692c12de752408221e",
              "ea98e67232d3b3295d3b535532115ccac8612c721851617526ae47a9c77bfc82"
            ]
          ]
        },
        naf: {
          wnd: 7,
          points: [
            [
              "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
              "388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672"
            ],
            [
              "2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4",
              "d8ac222636e5e3d6d4dba9dda6c9c426f788271bab0d6840dca87d3aa6ac62d6"
            ],
            [
              "5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc",
              "6aebca40ba255960a3178d6d861a54dba813d0b813fde7b5a5082628087264da"
            ],
            [
              "acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe",
              "cc338921b0a7d9fd64380971763b61e9add888a4375f8e0f05cc262ac64f9c37"
            ],
            [
              "774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb",
              "d984a032eb6b5e190243dd56d7b7b365372db1e2dff9d6a8301d74c9c953c61b"
            ],
            [
              "f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8",
              "ab0902e8d880a89758212eb65cdaf473a1a06da521fa91f29b5cb52db03ed81"
            ],
            [
              "d7924d4f7d43ea965a465ae3095ff41131e5946f3c85f79e44adbcf8e27e080e",
              "581e2872a86c72a683842ec228cc6defea40af2bd896d3a5c504dc9ff6a26b58"
            ],
            [
              "defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34",
              "4211ab0694635168e997b0ead2a93daeced1f4a04a95c0f6cfb199f69e56eb77"
            ],
            [
              "2b4ea0a797a443d293ef5cff444f4979f06acfebd7e86d277475656138385b6c",
              "85e89bc037945d93b343083b5a1c86131a01f60c50269763b570c854e5c09b7a"
            ],
            [
              "352bbf4a4cdd12564f93fa332ce333301d9ad40271f8107181340aef25be59d5",
              "321eb4075348f534d59c18259dda3e1f4a1b3b2e71b1039c67bd3d8bcf81998c"
            ],
            [
              "2fa2104d6b38d11b0230010559879124e42ab8dfeff5ff29dc9cdadd4ecacc3f",
              "2de1068295dd865b64569335bd5dd80181d70ecfc882648423ba76b532b7d67"
            ],
            [
              "9248279b09b4d68dab21a9b066edda83263c3d84e09572e269ca0cd7f5453714",
              "73016f7bf234aade5d1aa71bdea2b1ff3fc0de2a887912ffe54a32ce97cb3402"
            ],
            [
              "daed4f2be3a8bf278e70132fb0beb7522f570e144bf615c07e996d443dee8729",
              "a69dce4a7d6c98e8d4a1aca87ef8d7003f83c230f3afa726ab40e52290be1c55"
            ],
            [
              "c44d12c7065d812e8acf28d7cbb19f9011ecd9e9fdf281b0e6a3b5e87d22e7db",
              "2119a460ce326cdc76c45926c982fdac0e106e861edf61c5a039063f0e0e6482"
            ],
            [
              "6a245bf6dc698504c89a20cfded60853152b695336c28063b61c65cbd269e6b4",
              "e022cf42c2bd4a708b3f5126f16a24ad8b33ba48d0423b6efd5e6348100d8a82"
            ],
            [
              "1697ffa6fd9de627c077e3d2fe541084ce13300b0bec1146f95ae57f0d0bd6a5",
              "b9c398f186806f5d27561506e4557433a2cf15009e498ae7adee9d63d01b2396"
            ],
            [
              "605bdb019981718b986d0f07e834cb0d9deb8360ffb7f61df982345ef27a7479",
              "2972d2de4f8d20681a78d93ec96fe23c26bfae84fb14db43b01e1e9056b8c49"
            ],
            [
              "62d14dab4150bf497402fdc45a215e10dcb01c354959b10cfe31c7e9d87ff33d",
              "80fc06bd8cc5b01098088a1950eed0db01aa132967ab472235f5642483b25eaf"
            ],
            [
              "80c60ad0040f27dade5b4b06c408e56b2c50e9f56b9b8b425e555c2f86308b6f",
              "1c38303f1cc5c30f26e66bad7fe72f70a65eed4cbe7024eb1aa01f56430bd57a"
            ],
            [
              "7a9375ad6167ad54aa74c6348cc54d344cc5dc9487d847049d5eabb0fa03c8fb",
              "d0e3fa9eca8726909559e0d79269046bdc59ea10c70ce2b02d499ec224dc7f7"
            ],
            [
              "d528ecd9b696b54c907a9ed045447a79bb408ec39b68df504bb51f459bc3ffc9",
              "eecf41253136e5f99966f21881fd656ebc4345405c520dbc063465b521409933"
            ],
            [
              "49370a4b5f43412ea25f514e8ecdad05266115e4a7ecb1387231808f8b45963",
              "758f3f41afd6ed428b3081b0512fd62a54c3f3afbb5b6764b653052a12949c9a"
            ],
            [
              "77f230936ee88cbbd73df930d64702ef881d811e0e1498e2f1c13eb1fc345d74",
              "958ef42a7886b6400a08266e9ba1b37896c95330d97077cbbe8eb3c7671c60d6"
            ],
            [
              "f2dac991cc4ce4b9ea44887e5c7c0bce58c80074ab9d4dbaeb28531b7739f530",
              "e0dedc9b3b2f8dad4da1f32dec2531df9eb5fbeb0598e4fd1a117dba703a3c37"
            ],
            [
              "463b3d9f662621fb1b4be8fbbe2520125a216cdfc9dae3debcba4850c690d45b",
              "5ed430d78c296c3543114306dd8622d7c622e27c970a1de31cb377b01af7307e"
            ],
            [
              "f16f804244e46e2a09232d4aff3b59976b98fac14328a2d1a32496b49998f247",
              "cedabd9b82203f7e13d206fcdf4e33d92a6c53c26e5cce26d6579962c4e31df6"
            ],
            [
              "caf754272dc84563b0352b7a14311af55d245315ace27c65369e15f7151d41d1",
              "cb474660ef35f5f2a41b643fa5e460575f4fa9b7962232a5c32f908318a04476"
            ],
            [
              "2600ca4b282cb986f85d0f1709979d8b44a09c07cb86d7c124497bc86f082120",
              "4119b88753c15bd6a693b03fcddbb45d5ac6be74ab5f0ef44b0be9475a7e4b40"
            ],
            [
              "7635ca72d7e8432c338ec53cd12220bc01c48685e24f7dc8c602a7746998e435",
              "91b649609489d613d1d5e590f78e6d74ecfc061d57048bad9e76f302c5b9c61"
            ],
            [
              "754e3239f325570cdbbf4a87deee8a66b7f2b33479d468fbc1a50743bf56cc18",
              "673fb86e5bda30fb3cd0ed304ea49a023ee33d0197a695d0c5d98093c536683"
            ],
            [
              "e3e6bd1071a1e96aff57859c82d570f0330800661d1c952f9fe2694691d9b9e8",
              "59c9e0bba394e76f40c0aa58379a3cb6a5a2283993e90c4167002af4920e37f5"
            ],
            [
              "186b483d056a033826ae73d88f732985c4ccb1f32ba35f4b4cc47fdcf04aa6eb",
              "3b952d32c67cf77e2e17446e204180ab21fb8090895138b4a4a797f86e80888b"
            ],
            [
              "df9d70a6b9876ce544c98561f4be4f725442e6d2b737d9c91a8321724ce0963f",
              "55eb2dafd84d6ccd5f862b785dc39d4ab157222720ef9da217b8c45cf2ba2417"
            ],
            [
              "5edd5cc23c51e87a497ca815d5dce0f8ab52554f849ed8995de64c5f34ce7143",
              "efae9c8dbc14130661e8cec030c89ad0c13c66c0d17a2905cdc706ab7399a868"
            ],
            [
              "290798c2b6476830da12fe02287e9e777aa3fba1c355b17a722d362f84614fba",
              "e38da76dcd440621988d00bcf79af25d5b29c094db2a23146d003afd41943e7a"
            ],
            [
              "af3c423a95d9f5b3054754efa150ac39cd29552fe360257362dfdecef4053b45",
              "f98a3fd831eb2b749a93b0e6f35cfb40c8cd5aa667a15581bc2feded498fd9c6"
            ],
            [
              "766dbb24d134e745cccaa28c99bf274906bb66b26dcf98df8d2fed50d884249a",
              "744b1152eacbe5e38dcc887980da38b897584a65fa06cedd2c924f97cbac5996"
            ],
            [
              "59dbf46f8c94759ba21277c33784f41645f7b44f6c596a58ce92e666191abe3e",
              "c534ad44175fbc300f4ea6ce648309a042ce739a7919798cd85e216c4a307f6e"
            ],
            [
              "f13ada95103c4537305e691e74e9a4a8dd647e711a95e73cb62dc6018cfd87b8",
              "e13817b44ee14de663bf4bc808341f326949e21a6a75c2570778419bdaf5733d"
            ],
            [
              "7754b4fa0e8aced06d4167a2c59cca4cda1869c06ebadfb6488550015a88522c",
              "30e93e864e669d82224b967c3020b8fa8d1e4e350b6cbcc537a48b57841163a2"
            ],
            [
              "948dcadf5990e048aa3874d46abef9d701858f95de8041d2a6828c99e2262519",
              "e491a42537f6e597d5d28a3224b1bc25df9154efbd2ef1d2cbba2cae5347d57e"
            ],
            [
              "7962414450c76c1689c7b48f8202ec37fb224cf5ac0bfa1570328a8a3d7c77ab",
              "100b610ec4ffb4760d5c1fc133ef6f6b12507a051f04ac5760afa5b29db83437"
            ],
            [
              "3514087834964b54b15b160644d915485a16977225b8847bb0dd085137ec47ca",
              "ef0afbb2056205448e1652c48e8127fc6039e77c15c2378b7e7d15a0de293311"
            ],
            [
              "d3cc30ad6b483e4bc79ce2c9dd8bc54993e947eb8df787b442943d3f7b527eaf",
              "8b378a22d827278d89c5e9be8f9508ae3c2ad46290358630afb34db04eede0a4"
            ],
            [
              "1624d84780732860ce1c78fcbfefe08b2b29823db913f6493975ba0ff4847610",
              "68651cf9b6da903e0914448c6cd9d4ca896878f5282be4c8cc06e2a404078575"
            ],
            [
              "733ce80da955a8a26902c95633e62a985192474b5af207da6df7b4fd5fc61cd4",
              "f5435a2bd2badf7d485a4d8b8db9fcce3e1ef8e0201e4578c54673bc1dc5ea1d"
            ],
            [
              "15d9441254945064cf1a1c33bbd3b49f8966c5092171e699ef258dfab81c045c",
              "d56eb30b69463e7234f5137b73b84177434800bacebfc685fc37bbe9efe4070d"
            ],
            [
              "a1d0fcf2ec9de675b612136e5ce70d271c21417c9d2b8aaaac138599d0717940",
              "edd77f50bcb5a3cab2e90737309667f2641462a54070f3d519212d39c197a629"
            ],
            [
              "e22fbe15c0af8ccc5780c0735f84dbe9a790badee8245c06c7ca37331cb36980",
              "a855babad5cd60c88b430a69f53a1a7a38289154964799be43d06d77d31da06"
            ],
            [
              "311091dd9860e8e20ee13473c1155f5f69635e394704eaa74009452246cfa9b3",
              "66db656f87d1f04fffd1f04788c06830871ec5a64feee685bd80f0b1286d8374"
            ],
            [
              "34c1fd04d301be89b31c0442d3e6ac24883928b45a9340781867d4232ec2dbdf",
              "9414685e97b1b5954bd46f730174136d57f1ceeb487443dc5321857ba73abee"
            ],
            [
              "f219ea5d6b54701c1c14de5b557eb42a8d13f3abbcd08affcc2a5e6b049b8d63",
              "4cb95957e83d40b0f73af4544cccf6b1f4b08d3c07b27fb8d8c2962a400766d1"
            ],
            [
              "d7b8740f74a8fbaab1f683db8f45de26543a5490bca627087236912469a0b448",
              "fa77968128d9c92ee1010f337ad4717eff15db5ed3c049b3411e0315eaa4593b"
            ],
            [
              "32d31c222f8f6f0ef86f7c98d3a3335ead5bcd32abdd94289fe4d3091aa824bf",
              "5f3032f5892156e39ccd3d7915b9e1da2e6dac9e6f26e961118d14b8462e1661"
            ],
            [
              "7461f371914ab32671045a155d9831ea8793d77cd59592c4340f86cbc18347b5",
              "8ec0ba238b96bec0cbdddcae0aa442542eee1ff50c986ea6b39847b3cc092ff6"
            ],
            [
              "ee079adb1df1860074356a25aa38206a6d716b2c3e67453d287698bad7b2b2d6",
              "8dc2412aafe3be5c4c5f37e0ecc5f9f6a446989af04c4e25ebaac479ec1c8c1e"
            ],
            [
              "16ec93e447ec83f0467b18302ee620f7e65de331874c9dc72bfd8616ba9da6b5",
              "5e4631150e62fb40d0e8c2a7ca5804a39d58186a50e497139626778e25b0674d"
            ],
            [
              "eaa5f980c245f6f038978290afa70b6bd8855897f98b6aa485b96065d537bd99",
              "f65f5d3e292c2e0819a528391c994624d784869d7e6ea67fb18041024edc07dc"
            ],
            [
              "78c9407544ac132692ee1910a02439958ae04877151342ea96c4b6b35a49f51",
              "f3e0319169eb9b85d5404795539a5e68fa1fbd583c064d2462b675f194a3ddb4"
            ],
            [
              "494f4be219a1a77016dcd838431aea0001cdc8ae7a6fc688726578d9702857a5",
              "42242a969283a5f339ba7f075e36ba2af925ce30d767ed6e55f4b031880d562c"
            ],
            [
              "a598a8030da6d86c6bc7f2f5144ea549d28211ea58faa70ebf4c1e665c1fe9b5",
              "204b5d6f84822c307e4b4a7140737aec23fc63b65b35f86a10026dbd2d864e6b"
            ],
            [
              "c41916365abb2b5d09192f5f2dbeafec208f020f12570a184dbadc3e58595997",
              "4f14351d0087efa49d245b328984989d5caf9450f34bfc0ed16e96b58fa9913"
            ],
            [
              "841d6063a586fa475a724604da03bc5b92a2e0d2e0a36acfe4c73a5514742881",
              "73867f59c0659e81904f9a1c7543698e62562d6744c169ce7a36de01a8d6154"
            ],
            [
              "5e95bb399a6971d376026947f89bde2f282b33810928be4ded112ac4d70e20d5",
              "39f23f366809085beebfc71181313775a99c9aed7d8ba38b161384c746012865"
            ],
            [
              "36e4641a53948fd476c39f8a99fd974e5ec07564b5315d8bf99471bca0ef2f66",
              "d2424b1b1abe4eb8164227b085c9aa9456ea13493fd563e06fd51cf5694c78fc"
            ],
            [
              "336581ea7bfbbb290c191a2f507a41cf5643842170e914faeab27c2c579f726",
              "ead12168595fe1be99252129b6e56b3391f7ab1410cd1e0ef3dcdcabd2fda224"
            ],
            [
              "8ab89816dadfd6b6a1f2634fcf00ec8403781025ed6890c4849742706bd43ede",
              "6fdcef09f2f6d0a044e654aef624136f503d459c3e89845858a47a9129cdd24e"
            ],
            [
              "1e33f1a746c9c5778133344d9299fcaa20b0938e8acff2544bb40284b8c5fb94",
              "60660257dd11b3aa9c8ed618d24edff2306d320f1d03010e33a7d2057f3b3b6"
            ],
            [
              "85b7c1dcb3cec1b7ee7f30ded79dd20a0ed1f4cc18cbcfcfa410361fd8f08f31",
              "3d98a9cdd026dd43f39048f25a8847f4fcafad1895d7a633c6fed3c35e999511"
            ],
            [
              "29df9fbd8d9e46509275f4b125d6d45d7fbe9a3b878a7af872a2800661ac5f51",
              "b4c4fe99c775a606e2d8862179139ffda61dc861c019e55cd2876eb2a27d84b"
            ],
            [
              "a0b1cae06b0a847a3fea6e671aaf8adfdfe58ca2f768105c8082b2e449fce252",
              "ae434102edde0958ec4b19d917a6a28e6b72da1834aff0e650f049503a296cf2"
            ],
            [
              "4e8ceafb9b3e9a136dc7ff67e840295b499dfb3b2133e4ba113f2e4c0e121e5",
              "cf2174118c8b6d7a4b48f6d534ce5c79422c086a63460502b827ce62a326683c"
            ],
            [
              "d24a44e047e19b6f5afb81c7ca2f69080a5076689a010919f42725c2b789a33b",
              "6fb8d5591b466f8fc63db50f1c0f1c69013f996887b8244d2cdec417afea8fa3"
            ],
            [
              "ea01606a7a6c9cdd249fdfcfacb99584001edd28abbab77b5104e98e8e3b35d4",
              "322af4908c7312b0cfbfe369f7a7b3cdb7d4494bc2823700cfd652188a3ea98d"
            ],
            [
              "af8addbf2b661c8a6c6328655eb96651252007d8c5ea31be4ad196de8ce2131f",
              "6749e67c029b85f52a034eafd096836b2520818680e26ac8f3dfbcdb71749700"
            ],
            [
              "e3ae1974566ca06cc516d47e0fb165a674a3dabcfca15e722f0e3450f45889",
              "2aeabe7e4531510116217f07bf4d07300de97e4874f81f533420a72eeb0bd6a4"
            ],
            [
              "591ee355313d99721cf6993ffed1e3e301993ff3ed258802075ea8ced397e246",
              "b0ea558a113c30bea60fc4775460c7901ff0b053d25ca2bdeee98f1a4be5d196"
            ],
            [
              "11396d55fda54c49f19aa97318d8da61fa8584e47b084945077cf03255b52984",
              "998c74a8cd45ac01289d5833a7beb4744ff536b01b257be4c5767bea93ea57a4"
            ],
            [
              "3c5d2a1ba39c5a1790000738c9e0c40b8dcdfd5468754b6405540157e017aa7a",
              "b2284279995a34e2f9d4de7396fc18b80f9b8b9fdd270f6661f79ca4c81bd257"
            ],
            [
              "cc8704b8a60a0defa3a99a7299f2e9c3fbc395afb04ac078425ef8a1793cc030",
              "bdd46039feed17881d1e0862db347f8cf395b74fc4bcdc4e940b74e3ac1f1b13"
            ],
            [
              "c533e4f7ea8555aacd9777ac5cad29b97dd4defccc53ee7ea204119b2889b197",
              "6f0a256bc5efdf429a2fb6242f1a43a2d9b925bb4a4b3a26bb8e0f45eb596096"
            ],
            [
              "c14f8f2ccb27d6f109f6d08d03cc96a69ba8c34eec07bbcf566d48e33da6593",
              "c359d6923bb398f7fd4473e16fe1c28475b740dd098075e6c0e8649113dc3a38"
            ],
            [
              "a6cbc3046bc6a450bac24789fa17115a4c9739ed75f8f21ce441f72e0b90e6ef",
              "21ae7f4680e889bb130619e2c0f95a360ceb573c70603139862afd617fa9b9f"
            ],
            [
              "347d6d9a02c48927ebfb86c1359b1caf130a3c0267d11ce6344b39f99d43cc38",
              "60ea7f61a353524d1c987f6ecec92f086d565ab687870cb12689ff1e31c74448"
            ],
            [
              "da6545d2181db8d983f7dcb375ef5866d47c67b1bf31c8cf855ef7437b72656a",
              "49b96715ab6878a79e78f07ce5680c5d6673051b4935bd897fea824b77dc208a"
            ],
            [
              "c40747cc9d012cb1a13b8148309c6de7ec25d6945d657146b9d5994b8feb1111",
              "5ca560753be2a12fc6de6caf2cb489565db936156b9514e1bb5e83037e0fa2d4"
            ],
            [
              "4e42c8ec82c99798ccf3a610be870e78338c7f713348bd34c8203ef4037f3502",
              "7571d74ee5e0fb92a7a8b33a07783341a5492144cc54bcc40a94473693606437"
            ],
            [
              "3775ab7089bc6af823aba2e1af70b236d251cadb0c86743287522a1b3b0dedea",
              "be52d107bcfa09d8bcb9736a828cfa7fac8db17bf7a76a2c42ad961409018cf7"
            ],
            [
              "cee31cbf7e34ec379d94fb814d3d775ad954595d1314ba8846959e3e82f74e26",
              "8fd64a14c06b589c26b947ae2bcf6bfa0149ef0be14ed4d80f448a01c43b1c6d"
            ],
            [
              "b4f9eaea09b6917619f6ea6a4eb5464efddb58fd45b1ebefcdc1a01d08b47986",
              "39e5c9925b5a54b07433a4f18c61726f8bb131c012ca542eb24a8ac07200682a"
            ],
            [
              "d4263dfc3d2df923a0179a48966d30ce84e2515afc3dccc1b77907792ebcc60e",
              "62dfaf07a0f78feb30e30d6295853ce189e127760ad6cf7fae164e122a208d54"
            ],
            [
              "48457524820fa65a4f8d35eb6930857c0032acc0a4a2de422233eeda897612c4",
              "25a748ab367979d98733c38a1fa1c2e7dc6cc07db2d60a9ae7a76aaa49bd0f77"
            ],
            [
              "dfeeef1881101f2cb11644f3a2afdfc2045e19919152923f367a1767c11cceda",
              "ecfb7056cf1de042f9420bab396793c0c390bde74b4bbdff16a83ae09a9a7517"
            ],
            [
              "6d7ef6b17543f8373c573f44e1f389835d89bcbc6062ced36c82df83b8fae859",
              "cd450ec335438986dfefa10c57fea9bcc521a0959b2d80bbf74b190dca712d10"
            ],
            [
              "e75605d59102a5a2684500d3b991f2e3f3c88b93225547035af25af66e04541f",
              "f5c54754a8f71ee540b9b48728473e314f729ac5308b06938360990e2bfad125"
            ],
            [
              "eb98660f4c4dfaa06a2be453d5020bc99a0c2e60abe388457dd43fefb1ed620c",
              "6cb9a8876d9cb8520609af3add26cd20a0a7cd8a9411131ce85f44100099223e"
            ],
            [
              "13e87b027d8514d35939f2e6892b19922154596941888336dc3563e3b8dba942",
              "fef5a3c68059a6dec5d624114bf1e91aac2b9da568d6abeb2570d55646b8adf1"
            ],
            [
              "ee163026e9fd6fe017c38f06a5be6fc125424b371ce2708e7bf4491691e5764a",
              "1acb250f255dd61c43d94ccc670d0f58f49ae3fa15b96623e5430da0ad6c62b2"
            ],
            [
              "b268f5ef9ad51e4d78de3a750c2dc89b1e626d43505867999932e5db33af3d80",
              "5f310d4b3c99b9ebb19f77d41c1dee018cf0d34fd4191614003e945a1216e423"
            ],
            [
              "ff07f3118a9df035e9fad85eb6c7bfe42b02f01ca99ceea3bf7ffdba93c4750d",
              "438136d603e858a3a5c440c38eccbaddc1d2942114e2eddd4740d098ced1f0d8"
            ],
            [
              "8d8b9855c7c052a34146fd20ffb658bea4b9f69e0d825ebec16e8c3ce2b526a1",
              "cdb559eedc2d79f926baf44fb84ea4d44bcf50fee51d7ceb30e2e7f463036758"
            ],
            [
              "52db0b5384dfbf05bfa9d472d7ae26dfe4b851ceca91b1eba54263180da32b63",
              "c3b997d050ee5d423ebaf66a6db9f57b3180c902875679de924b69d84a7b375"
            ],
            [
              "e62f9490d3d51da6395efd24e80919cc7d0f29c3f3fa48c6fff543becbd43352",
              "6d89ad7ba4876b0b22c2ca280c682862f342c8591f1daf5170e07bfd9ccafa7d"
            ],
            [
              "7f30ea2476b399b4957509c88f77d0191afa2ff5cb7b14fd6d8e7d65aaab1193",
              "ca5ef7d4b231c94c3b15389a5f6311e9daff7bb67b103e9880ef4bff637acaec"
            ],
            [
              "5098ff1e1d9f14fb46a210fada6c903fef0fb7b4a1dd1d9ac60a0361800b7a00",
              "9731141d81fc8f8084d37c6e7542006b3ee1b40d60dfe5362a5b132fd17ddc0"
            ],
            [
              "32b78c7de9ee512a72895be6b9cbefa6e2f3c4ccce445c96b9f2c81e2778ad58",
              "ee1849f513df71e32efc3896ee28260c73bb80547ae2275ba497237794c8753c"
            ],
            [
              "e2cb74fddc8e9fbcd076eef2a7c72b0ce37d50f08269dfc074b581550547a4f7",
              "d3aa2ed71c9dd2247a62df062736eb0baddea9e36122d2be8641abcb005cc4a4"
            ],
            [
              "8438447566d4d7bedadc299496ab357426009a35f235cb141be0d99cd10ae3a8",
              "c4e1020916980a4da5d01ac5e6ad330734ef0d7906631c4f2390426b2edd791f"
            ],
            [
              "4162d488b89402039b584c6fc6c308870587d9c46f660b878ab65c82c711d67e",
              "67163e903236289f776f22c25fb8a3afc1732f2b84b4e95dbda47ae5a0852649"
            ],
            [
              "3fad3fa84caf0f34f0f89bfd2dcf54fc175d767aec3e50684f3ba4a4bf5f683d",
              "cd1bc7cb6cc407bb2f0ca647c718a730cf71872e7d0d2a53fa20efcdfe61826"
            ],
            [
              "674f2600a3007a00568c1a7ce05d0816c1fb84bf1370798f1c69532faeb1a86b",
              "299d21f9413f33b3edf43b257004580b70db57da0b182259e09eecc69e0d38a5"
            ],
            [
              "d32f4da54ade74abb81b815ad1fb3b263d82d6c692714bcff87d29bd5ee9f08f",
              "f9429e738b8e53b968e99016c059707782e14f4535359d582fc416910b3eea87"
            ],
            [
              "30e4e670435385556e593657135845d36fbb6931f72b08cb1ed954f1e3ce3ff6",
              "462f9bce619898638499350113bbc9b10a878d35da70740dc695a559eb88db7b"
            ],
            [
              "be2062003c51cc3004682904330e4dee7f3dcd10b01e580bf1971b04d4cad297",
              "62188bc49d61e5428573d48a74e1c655b1c61090905682a0d5558ed72dccb9bc"
            ],
            [
              "93144423ace3451ed29e0fb9ac2af211cb6e84a601df5993c419859fff5df04a",
              "7c10dfb164c3425f5c71a3f9d7992038f1065224f72bb9d1d902a6d13037b47c"
            ],
            [
              "b015f8044f5fcbdcf21ca26d6c34fb8197829205c7b7d2a7cb66418c157b112c",
              "ab8c1e086d04e813744a655b2df8d5f83b3cdc6faa3088c1d3aea1454e3a1d5f"
            ],
            [
              "d5e9e1da649d97d89e4868117a465a3a4f8a18de57a140d36b3f2af341a21b52",
              "4cb04437f391ed73111a13cc1d4dd0db1693465c2240480d8955e8592f27447a"
            ],
            [
              "d3ae41047dd7ca065dbf8ed77b992439983005cd72e16d6f996a5316d36966bb",
              "bd1aeb21ad22ebb22a10f0303417c6d964f8cdd7df0aca614b10dc14d125ac46"
            ],
            [
              "463e2763d885f958fc66cdd22800f0a487197d0a82e377b49f80af87c897b065",
              "bfefacdb0e5d0fd7df3a311a94de062b26b80c61fbc97508b79992671ef7ca7f"
            ],
            [
              "7985fdfd127c0567c6f53ec1bb63ec3158e597c40bfe747c83cddfc910641917",
              "603c12daf3d9862ef2b25fe1de289aed24ed291e0ec6708703a5bd567f32ed03"
            ],
            [
              "74a1ad6b5f76e39db2dd249410eac7f99e74c59cb83d2d0ed5ff1543da7703e9",
              "cc6157ef18c9c63cd6193d83631bbea0093e0968942e8c33d5737fd790e0db08"
            ],
            [
              "30682a50703375f602d416664ba19b7fc9bab42c72747463a71d0896b22f6da3",
              "553e04f6b018b4fa6c8f39e7f311d3176290d0e0f19ca73f17714d9977a22ff8"
            ],
            [
              "9e2158f0d7c0d5f26c3791efefa79597654e7a2b2464f52b1ee6c1347769ef57",
              "712fcdd1b9053f09003a3481fa7762e9ffd7c8ef35a38509e2fbf2629008373"
            ],
            [
              "176e26989a43c9cfeba4029c202538c28172e566e3c4fce7322857f3be327d66",
              "ed8cc9d04b29eb877d270b4878dc43c19aefd31f4eee09ee7b47834c1fa4b1c3"
            ],
            [
              "75d46efea3771e6e68abb89a13ad747ecf1892393dfc4f1b7004788c50374da8",
              "9852390a99507679fd0b86fd2b39a868d7efc22151346e1a3ca4726586a6bed8"
            ],
            [
              "809a20c67d64900ffb698c4c825f6d5f2310fb0451c869345b7319f645605721",
              "9e994980d9917e22b76b061927fa04143d096ccc54963e6a5ebfa5f3f8e286c1"
            ],
            [
              "1b38903a43f7f114ed4500b4eac7083fdefece1cf29c63528d563446f972c180",
              "4036edc931a60ae889353f77fd53de4a2708b26b6f5da72ad3394119daf408f9"
            ]
          ]
        }
      };
      const conf = {
        prime: "k256",
        p: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f",
        a: "0",
        b: "7",
        n: "ffffffff ffffffff ffffffff fffffffe baaedce6 af48a03b bfd25e8c d0364141",
        h: "1",
        // Precomputed endomorphism
        beta: "7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee",
        lambda: "5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72",
        basis: [
          {
            a: "3086d221a7d46bcde86c90e49284eb15",
            b: "-e4437ed6010e88286f547fa90abfe4c3"
          },
          {
            a: "114ca50f7a8e2f3f657c1108d9d44cfd8",
            b: "3086d221a7d46bcde86c90e49284eb15"
          }
        ],
        gRed: false,
        g: [
          "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
          precomputed
        ]
      };
      this.p = new BigNumber(conf.p, 16);
      this.red = new ReductionContext(conf.prime);
      this.zero = new BigNumber(0).toRed(this.red);
      this.one = new BigNumber(1).toRed(this.red);
      this.two = new BigNumber(2).toRed(this.red);
      this.n = new BigNumber(conf.n, 16);
      this.g = Point.fromJSON(conf.g, conf.gRed);
      this._wnafT1 = new Array(4);
      this._wnafT2 = new Array(4);
      this._wnafT3 = new Array(4);
      this._wnafT4 = new Array(4);
      this._bitLength = this.n.bitLength();
      this.redN = this.n.toRed(this.red);
      this.a = new BigNumber(conf.a, 16).toRed(this.red);
      this.b = new BigNumber(conf.b, 16).toRed(this.red);
      this.tinv = this.two.redInvm();
      this.zeroA = this.a.fromRed().cmpn(0) === 0;
      this.threeA = this.a.fromRed().sub(this.p).cmpn(-3) === 0;
      this.endo = this._getEndomorphism(conf);
      this._endoWnafT1 = new Array(4);
      this._endoWnafT2 = new Array(4);
    }
    // Represent num in a w-NAF form
    static assert(expression, message = "Elliptic curve assertion failed") {
      if (!expression) {
        throw new Error(message);
      }
    }
    getNAF(num, w, bits) {
      const naf = new Array(Math.max(num.bitLength(), bits) + 1);
      naf.fill(0);
      const ws = 1 << w + 1;
      const k = num.clone();
      for (let i = 0; i < naf.length; i++) {
        let z;
        const mod = k.andln(ws - 1);
        if (k.isOdd()) {
          if (mod > (ws >> 1) - 1) {
            z = (ws >> 1) - mod;
          } else {
            z = mod;
          }
          k.isubn(z);
        } else {
          z = 0;
        }
        naf[i] = z;
        k.iushrn(1);
      }
      return naf;
    }
    // Represent k1, k2 in a Joint Sparse Form
    getJSF(k1, k2) {
      const jsf = [[], []];
      k1 = k1.clone();
      k2 = k2.clone();
      let d1 = 0;
      let d2 = 0;
      while (k1.cmpn(-d1) > 0 || k2.cmpn(-d2) > 0) {
        let m14 = k1.andln(3) + d1 & 3;
        let m24 = k2.andln(3) + d2 & 3;
        if (m14 === 3) {
          m14 = -1;
        }
        if (m24 === 3) {
          m24 = -1;
        }
        let u1;
        if ((m14 & 1) === 0) {
          u1 = 0;
        } else {
          const m8 = k1.andln(7) + d1 & 7;
          if ((m8 === 3 || m8 === 5) && m24 === 2) {
            u1 = -m14;
          } else {
            u1 = m14;
          }
        }
        jsf[0].push(u1);
        let u2;
        if ((m24 & 1) === 0) {
          u2 = 0;
        } else {
          const m8 = k2.andln(7) + d2 & 7;
          if ((m8 === 3 || m8 === 5) && m14 === 2) {
            u2 = -m24;
          } else {
            u2 = m24;
          }
        }
        jsf[1].push(u2);
        if (2 * d1 === u1 + 1) {
          d1 = 1 - d1;
        }
        if (2 * d2 === u2 + 1) {
          d2 = 1 - d2;
        }
        k1.iushrn(1);
        k2.iushrn(1);
      }
      return jsf;
    }
    static cachedProperty(obj, name, computer) {
      const key = "_" + name;
      obj.prototype[name] = function cachedProperty() {
        const r2 = this[key] !== void 0 ? this[key] : this[key] = computer.call(this);
        return r2;
      };
    }
    static parseBytes(bytes2) {
      return typeof bytes2 === "string" ? toArray2(bytes2, "hex") : bytes2;
    }
    static intFromLE(bytes2) {
      return new BigNumber(bytes2, "hex", "le");
    }
    _getEndomorphism(conf) {
      if (!this.zeroA || this.p.modrn(3) !== 1) {
        return;
      }
      let beta;
      let lambda;
      if (conf.beta !== void 0) {
        beta = new BigNumber(conf.beta, 16).toRed(this.red);
      } else {
        const betas = this._getEndoRoots(this.p);
        if (betas === null) {
          throw new Error("Failed to get endomorphism roots for beta.");
        }
        beta = betas[0].cmp(betas[1]) < 0 ? betas[0] : betas[1];
        beta = beta.toRed(this.red);
      }
      if (conf.lambda !== void 0) {
        lambda = new BigNumber(conf.lambda, 16);
      } else {
        const lambdas = this._getEndoRoots(this.n);
        if (lambdas === null) {
          throw new Error("Failed to get endomorphism roots for lambda.");
        }
        if (this.g == null) {
          throw new Error("Curve generator point (g) is not defined.");
        }
        const gMulX = this.g.mul(lambdas[0])?.x;
        const gXRedMulBeta = this.g.x != null ? this.g.x.redMul(beta) : void 0;
        if (gMulX != null && gXRedMulBeta != null && gMulX.cmp(gXRedMulBeta) === 0) {
          lambda = lambdas[0];
        } else {
          lambda = lambdas[1];
          if (this.g == null) {
            throw new Error("Curve generator point (g) is not defined.");
          }
          const gMulX2 = this.g.mul(lambda)?.x;
          const gXRedMulBeta2 = this.g.x != null ? this.g.x.redMul(beta) : void 0;
          if (gMulX2 == null || gXRedMulBeta2 == null) {
            throw new Error("Lambda computation failed: g.mul(lambda).x or g.x.redMul(beta) is undefined.");
          }
          _Curve.assert(gMulX2.cmp(gXRedMulBeta2) === 0, "Lambda selection does not match computed beta.");
        }
      }
      let basis;
      if (typeof conf.basis === "object" && conf.basis !== null) {
        basis = conf.basis.map(function(vec) {
          return {
            a: new BigNumber(vec.a, 16),
            b: new BigNumber(vec.b, 16)
          };
        });
      } else {
        basis = this._getEndoBasis(lambda);
      }
      return {
        beta,
        lambda,
        basis
      };
    }
    _getEndoRoots(num) {
      const red2 = num === this.p ? this.red : new MontgomoryMethod(num);
      const tinv = new BigNumber(2).toRed(red2).redInvm();
      const ntinv = tinv.redNeg();
      const s2 = new BigNumber(3).toRed(red2).redNeg().redSqrt().redMul(tinv);
      const l1 = ntinv.redAdd(s2).fromRed();
      const l2 = ntinv.redSub(s2).fromRed();
      return [l1, l2];
    }
    _getEndoBasis(lambda) {
      const aprxSqrt = this.n.ushrn(Math.floor(this.n.bitLength() / 2));
      let u = lambda;
      let v = this.n.clone();
      let x1 = new BigNumber(1);
      let y1 = new BigNumber(0);
      let x2 = new BigNumber(0);
      let y2 = new BigNumber(1);
      let a0;
      let b0;
      let a1;
      let b1;
      let a2;
      let b2;
      let prevR = new BigNumber(0);
      let i = 0;
      let r2 = new BigNumber(0);
      let x = new BigNumber(0);
      while (u.cmpn(0) !== 0) {
        const q = v.div(u);
        r2 = v.sub(q.mul(u));
        x = x2.sub(q.mul(x1));
        const y = y2.sub(q.mul(y1));
        if (a1 === void 0 && r2.cmp(aprxSqrt) < 0) {
          a0 = prevR.neg();
          b0 = x1;
          a1 = r2.neg();
          b1 = x;
        } else if (a1 !== void 0 && ++i === 2) {
          break;
        }
        prevR = r2;
        v = u;
        u = r2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
      }
      if (a0 === void 0 || b0 === void 0 || a1 === void 0 || b1 === void 0) {
        throw new Error("Failed to compute Endo Basis values");
      }
      a2 = r2.neg();
      b2 = x;
      const len1 = a1.sqr().add(b1.sqr());
      const len2 = a2.sqr().add(b2.sqr());
      if (len2.cmp(len1) >= 0) {
        a2 = a0;
        b2 = b0;
      }
      if (a1.negative !== 0) {
        a1 = a1.neg();
        b1 = b1.neg();
      }
      if (a2.negative !== 0) {
        a2 = a2.neg();
        b2 = b2.neg();
      }
      return [
        { a: a1, b: b1 },
        { a: a2, b: b2 }
      ];
    }
    _endoSplit(k) {
      if (this.endo == null) {
        throw new Error("Endomorphism is not defined.");
      }
      const basis = this.endo.basis;
      const v1 = basis[0];
      const v2 = basis[1];
      const c1 = v2.b.mul(k).divRound(this.n);
      const c2 = v1.b.neg().mul(k).divRound(this.n);
      const p1 = c1.mul(v1.a);
      const p2 = c2.mul(v2.a);
      const q1 = c1.mul(v1.b);
      const q2 = c2.mul(v2.b);
      const k1 = k.sub(p1).sub(p2);
      const k2 = q1.add(q2).neg();
      return { k1, k2 };
    }
    validate(point) {
      if (point.inf) {
        return true;
      }
      const x = point.x;
      const y = point.y;
      if (x === null || y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const ax = this.a.redMul(x);
      const rhs = x.redSqr().redMul(x).redIAdd(ax).redIAdd(this.b);
      return y.redSqr().redISub(rhs).cmpn(0) === 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Signature.js
  var Signature = class _Signature {
    /**
     * Creates an instance of the Signature class.
     *
     * @constructor
     * @param r - The R component of the signature.
     * @param s - The S component of the signature.
     *
     * @example
     * const r = new BigNumber('208755674028...');
     * const s = new BigNumber('564745627577...');
     * const signature = new Signature(r, s);
     */
    constructor(r2, s2) {
      /**
       * @property Represents the "r" component of the digital signature
       */
      __publicField(this, "r");
      /**
       * @property Represents the "s" component of the digital signature
       */
      __publicField(this, "s");
      this.r = r2;
      this.s = s2;
    }
    /**
     * Takes an array of numbers or a string and returns a new Signature instance.
     * This method will throw an error if the DER encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     *
     * @static
     * @method fromDER
     * @param data - The sequence to decode from DER encoding.
     * @param enc - The encoding of the data string.
     * @returns The decoded data in the form of Signature instance.
     *
     * @example
     * const signature = Signature.fromDER('30440220018c1f5502f8...', 'hex');
     */
    static fromDER(data, enc) {
      const getLength = (buf, p2) => {
        const initial = buf[p2.place++];
        if ((initial & 128) === 0) {
          return initial;
        } else {
          throw new Error("Invalid DER entity length");
        }
      };
      class Position {
        constructor() {
          __publicField(this, "place");
          this.place = 0;
        }
      }
      data = toArray2(data, enc);
      const p = new Position();
      if (data[p.place++] !== 48) {
        throw new Error("Signature DER must start with 0x30");
      }
      const len = getLength(data, p);
      if (len + p.place !== data.length) {
        throw new Error("Signature DER invalid");
      }
      if (data[p.place++] !== 2) {
        throw new Error("Signature DER invalid");
      }
      const rlen = getLength(data, p);
      let r2 = data.slice(p.place, rlen + p.place);
      p.place += rlen;
      if (data[p.place++] !== 2) {
        throw new Error("Signature DER invalid");
      }
      const slen = getLength(data, p);
      if (data.length !== slen + p.place) {
        throw new Error("Invalid R-length in signature DER");
      }
      let s2 = data.slice(p.place, slen + p.place);
      if (r2[0] === 0) {
        if ((r2[1] & 128) !== 0) {
          r2 = r2.slice(1);
        } else {
          throw new Error("Invalid R-value in signature DER");
        }
      }
      if (s2[0] === 0) {
        if ((s2[1] & 128) !== 0) {
          s2 = s2.slice(1);
        } else {
          throw new Error("Invalid S-value in signature DER");
        }
      }
      return new _Signature(new BigNumber(r2), new BigNumber(s2));
    }
    /**
     * Takes an array of numbers or a string and returns a new Signature instance.
     * This method will throw an error if the Compact encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     * compactByte value 27-30 means uncompressed public key.
     * 31-34 means compressed public key.
     * The range represents the recovery param which can be 0,1,2,3.
     * We could support recovery functions in future if there's demand.
     *
     * @static
     * @method fromCompact
     * @param data - The sequence to decode from Compact encoding.
     * @param enc - The encoding of the data string.
     * @returns The decoded data in the form of Signature instance.
     *
     * @example
     * const signature = Signature.fromCompact('1b18c1f5502f8...', 'hex');
     */
    static fromCompact(data, enc) {
      data = toArray2(data, enc);
      if (data.length !== 65) {
        throw new Error("Invalid Compact Signature");
      }
      const compactByte = data[0];
      if (compactByte < 27 || compactByte >= 35) {
        throw new Error("Invalid Compact Byte");
      }
      return new _Signature(new BigNumber(data.slice(1, 33)), new BigNumber(data.slice(33, 65)));
    }
    /**
     * Verifies a digital signature.
     *
     * This method will return true if the signature, key, and message hash match.
     * If the data or key do not match the signature, the function returns false.
     *
     * @method verify
     * @param msg - The message to verify.
     * @param key - The public key used to sign the original message.
     * @param enc - The encoding of the msg string.
     * @returns A boolean representing whether the signature is valid.
     *
     * @example
     * const msg = 'The quick brown fox jumps over the lazy dog';
     * const publicKey = PublicKey.fromString('04188ca1050...');
     * const isVerified = signature.verify(msg, publicKey);
     */
    verify(msg, key, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, this, key);
    }
    /**
     * Converts an instance of Signature into DER encoding.
     * An alias for the toDER method.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toDER
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const der = signature.toString('base64');
     */
    toString(enc) {
      return this.toDER(enc);
    }
    /**
     * Converts an instance of Signature into DER encoding.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toDER
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const der = signature.toDER('hex');
     */
    toDER(enc) {
      const constructLength = (arr2, len) => {
        if (len < 128) {
          arr2.push(len);
        } else {
          throw new Error("len must be < 0x80");
        }
      };
      const rmPadding = (buf) => {
        let i = 0;
        const len = buf.length - 1;
        while (buf[i] === 0 && (buf[i + 1] & 128) === 0 && i < len) {
          i++;
        }
        if (i === 0) {
          return buf;
        }
        return buf.slice(i);
      };
      let r2 = this.r.toArray();
      let s2 = this.s.toArray();
      if ((r2[0] & 128) !== 0) {
        r2 = [0].concat(r2);
      }
      if ((s2[0] & 128) !== 0) {
        s2 = [0].concat(s2);
      }
      r2 = rmPadding(r2);
      s2 = rmPadding(s2);
      while (s2[0] === 0 && (s2[1] & 128) === 0) {
        s2 = s2.slice(1);
      }
      let arr = [2];
      constructLength(arr, r2.length);
      arr = arr.concat(r2);
      arr.push(2);
      constructLength(arr, s2.length);
      const backHalf = arr.concat(s2);
      let res = [48];
      constructLength(res, backHalf.length);
      res = res.concat(backHalf);
      if (enc === "hex") {
        return toHex(res);
      } else if (enc === "base64") {
        return toBase64(res);
      } else {
        return res;
      }
    }
    /**
     * Converts an instance of Signature into Compact encoding.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toCompact
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const compact = signature.toCompact(3, true, 'base64');
     */
    toCompact(recovery, compressed, enc) {
      if (recovery < 0 || recovery > 3)
        throw new Error("Invalid recovery param");
      if (typeof compressed !== "boolean") {
        throw new Error("Invalid compressed param");
      }
      let compactByte = 27 + recovery;
      if (compressed) {
        compactByte += 4;
      }
      let arr = [compactByte];
      arr = arr.concat(this.r.toArray("be", 32));
      arr = arr.concat(this.s.toArray("be", 32));
      if (enc === "hex") {
        return toHex(arr);
      } else if (enc === "base64") {
        return toBase64(arr);
      } else {
        return arr;
      }
    }
    /**
     * Recovers the public key from a signature.
     * This method will return the public key if it finds a valid public key.
     * If it does not find a valid public key, it will throw an error.
     * The recovery factor is a number between 0 and 3.
     * @method RecoverPublicKey
     * @param recovery - The recovery factor.
     * @param e - The message hash.
     * @returns The public key associated with the signature.
     *
     * @example
     * const publicKey = signature.RecoverPublicKey(0, msgHash);
     */
    RecoverPublicKey(recovery, e) {
      const r2 = this.r;
      const s2 = this.s;
      const isYOdd = (recovery & 1) !== 0;
      const isSecondKey = recovery >> 1;
      const curve2 = new Curve();
      const n = curve2.n;
      const G = curve2.g;
      const x = isSecondKey !== 0 ? r2.add(n) : r2;
      const R2 = Point.fromX(x, isYOdd);
      const nR = R2.mul(n);
      if (!nR.isInfinity()) {
        throw new Error("nR is not at infinity");
      }
      const eNeg = e.neg().umod(n);
      const rInv = r2.invm(n);
      const srInv = rInv.mul(s2).umod(n);
      const eInvrInv = rInv.mul(eNeg).umod(n);
      const Q = G.mul(eInvrInv).add(R2.mul(srInv));
      const pubKey = new PublicKey(Q);
      pubKey.validate();
      return pubKey;
    }
    /**
     * Calculates the recovery factor which will work for a particular public key and message hash.
     * This method will return the recovery factor if it finds a valid recovery factor.
     * If it does not find a valid recovery factor, it will throw an error.
     * The recovery factor is a number between 0 and 3.
     *
     * @method CalculateRecoveryFactor
     * @param msgHash - The message hash.
     * @returns the recovery factor: number
     * /
     * @example
     * const recovery = signature.CalculateRecoveryFactor(publicKey, msgHash);
     */
    CalculateRecoveryFactor(pubkey, msgHash) {
      for (let recovery = 0; recovery < 4; recovery++) {
        let Qprime;
        try {
          Qprime = this.RecoverPublicKey(recovery, msgHash);
        } catch {
          continue;
        }
        if (pubkey.eq(Qprime)) {
          return recovery;
        }
      }
      throw new Error("Unable to find valid recovery factor");
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/DRBG.js
  var DRBG = class {
    constructor(entropy, nonce) {
      __publicField(this, "K");
      __publicField(this, "V");
      const entropyBytes = toArray2(entropy, "hex");
      const nonceBytes = toArray2(nonce, "hex");
      if (entropyBytes.length !== 32) {
        throw new Error("Entropy must be exactly 32 bytes (256 bits)");
      }
      if (nonceBytes.length !== 32) {
        throw new Error("Nonce must be exactly 32 bytes (256 bits)");
      }
      const seedMaterial = entropyBytes.concat(nonceBytes);
      this.K = new Array(32);
      this.V = new Array(32);
      for (let i = 0; i < 32; i++) {
        this.K[i] = 0;
        this.V[i] = 1;
      }
      this.update(seedMaterial);
    }
    /**
     * Generates HMAC using the K value of the instance. This method is used internally for operations.
     *
     * @method hmac
     * @returns The SHA256HMAC object created with K value.
     *
     * @example
     * const hmac = drbg.hmac();
     */
    hmac() {
      return new SHA256HMAC(this.K);
    }
    /**
     * Updates the `K` and `V` values of the instance based on the seed.
     * The seed if not provided uses `V` as seed.
     *
     * @method update
     * @param seed - an optional value that used to update `K` and `V`. Default is `undefined`.
     * @returns Nothing, but updates the internal state `K` and `V` value.
     *
     * @example
     * drbg.update('e13af...');
     */
    update(seed) {
      let kmac = this.hmac().update(this.V).update([0]);
      if (seed !== void 0) {
        kmac = kmac.update(seed);
      }
      this.K = kmac.digest();
      this.V = this.hmac().update(this.V).digest();
      if (seed === void 0) {
        return;
      }
      this.K = this.hmac().update(this.V).update([1]).update(seed).digest();
      this.V = this.hmac().update(this.V).digest();
    }
    /**
     * Generates deterministic random hexadecimal string of given length.
     * In every generation process, it also updates the internal state `K` and `V`.
     *
     * @method generate
     * @param len - The length of required random number.
     * @returns The required deterministic random hexadecimal string.
     *
     * @example
     * const randomHex = drbg.generate(256);
     */
    generate(len) {
      let temp = [];
      while (temp.length < len) {
        this.V = this.hmac().update(this.V).digest();
        temp = temp.concat(this.V);
      }
      const res = temp.slice(0, len);
      this.update();
      return toHex(res);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ECDSA.js
  function truncateToN(msg, truncOnly, curve2 = new Curve()) {
    const delta = msg.byteLength() * 8 - curve2.n.bitLength();
    if (delta > 0) {
      msg.iushrn(delta);
    }
    if (truncOnly !== true && msg.cmp(curve2.n) >= 0) {
      return msg.sub(curve2.n);
    } else {
      return msg;
    }
  }
  function bnToBigInt(bn) {
    const bytes2 = bn.toArray("be");
    let x = 0n;
    for (let i = 0; i < bytes2.length; i++) {
      x = x << 8n | BigInt(bytes2[i]);
    }
    return x;
  }
  var curve = new Curve();
  var bytes = curve.n.byteLength();
  var ns1 = curve.n.subn(1);
  var halfN = N_BIGINT >> 1n;
  var sign = (msg, key, forceLowS = false, customK) => {
    const nBitLength = curve.n.bitLength();
    if (msg.bitLength() > nBitLength) {
      throw new Error(`ECDSA message is too large: expected <= ${nBitLength} bits. Callers must hash messages before signing.`);
    }
    msg = truncateToN(msg);
    const msgBig = bnToBigInt(msg);
    const keyBig = bnToBigInt(key);
    const bkey = key.toArray("be", bytes);
    const nonce = msg.toArray("be", bytes);
    const drbg = new DRBG(bkey, nonce);
    for (let iter = 0; ; iter++) {
      let kBN = typeof customK === "function" ? customK(iter) : BigNumber.isBN(customK) ? customK : new BigNumber(drbg.generate(bytes), 16);
      if (kBN == null) {
        throw new Error("k is undefined");
      }
      kBN = truncateToN(kBN, true);
      if (kBN.cmpn(1) < 0 || kBN.cmp(ns1) > 0) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (must be >1 and <N-1)");
        }
        continue;
      }
      const R2 = curve.g.mulCT(kBN);
      if (R2.isInfinity()) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (k\xB7G at infinity)");
        }
        continue;
      }
      const xAff = BigInt("0x" + R2.getX().toString(16));
      const rBig = modN(xAff);
      if (rBig === 0n) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (r == 0)");
        }
        continue;
      }
      const kBig = BigInt("0x" + kBN.toString(16));
      const kInv = modInvN(kBig);
      const rTimesKey = modMulN(rBig, keyBig);
      const sum = modN(msgBig + rTimesKey);
      let sBig = modMulN(kInv, sum);
      if (sBig === 0n) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (s == 0)");
        }
        continue;
      }
      if (forceLowS && sBig > halfN) {
        sBig = N_BIGINT - sBig;
      }
      const r2 = new BigNumber(rBig.toString(16), 16);
      const s2 = new BigNumber(sBig.toString(16), 16);
      return new Signature(r2, s2);
    }
  };
  var verify = (msg, sig, key) => {
    const nBitLength = curve.n.bitLength();
    if (msg.bitLength() > nBitLength) {
      return false;
    }
    const hash = bnToBigInt(msg);
    if (key.x == null || key.y == null) {
      throw new Error("Invalid public key: missing coordinates.");
    }
    const publicKey = {
      x: bnToBigInt(key.x),
      y: bnToBigInt(key.y)
    };
    const signature = {
      r: bnToBigInt(sig.r),
      s: bnToBigInt(sig.s)
    };
    const { r: r2, s: s2 } = signature;
    const z = hash;
    if (r2 <= BI_ZERO || r2 >= N_BIGINT || s2 <= BI_ZERO || s2 >= N_BIGINT) {
      return false;
    }
    const w = modInvN(s2);
    if (w === 0n)
      return false;
    const u1 = modMulN(z, w);
    const u2 = modMulN(r2, w);
    const RG = scalarMultiplyWNAF(u1, { x: GX_BIGINT, y: GY_BIGINT });
    const RQ = scalarMultiplyWNAF(u2, publicKey);
    const R2 = jpAdd(RG, RQ);
    if (R2.Z === 0n)
      return false;
    const zInv = biModInv(R2.Z);
    const zInv2 = biModMul(zInv, zInv);
    const xAff = biModMul(R2.X, zInv2);
    const v = modN(xAff);
    return v === r2;
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/PublicKey.js
  var PublicKey = class _PublicKey extends Point {
    /**
     * Static factory method to derive a public key from a private key.
     * It multiplies the generator point 'g' on the elliptic curve by the private key.
     *
     * @static
     * @method fromPrivateKey
     *
     * @param key - The private key from which to derive the public key.
     *
     * @returns Returns the PublicKey derived from the given PrivateKey.
     *
     * @example
     * const myPrivKey = new PrivateKey(...)
     * const myPubKey = PublicKey.fromPrivateKey(myPrivKey)
     */
    static fromPrivateKey(key) {
      const c = new Curve();
      const p = c.g.mul(key);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * Static factory method to create a PublicKey instance from a string.
     *
     * @param str - A string representing a public key.
     *
     * @returns Returns the PublicKey created from the string.
     *
     * @example
     * const myPubKey = PublicKey.fromString("03....")
     */
    static fromString(str) {
      const p = Point.fromString(str);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * Static factory method to create a PublicKey instance from a number array.
     *
     * @param bytes - A number array representing a public key.
     *
     * @returns Returns the PublicKey created from the number array.
     *
     * @example
     * const myPubKey = PublicKey.fromString("03....")
     */
    static fromDER(bytes2) {
      const p = Point.fromDER(bytes2);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * @constructor
     * @param x - A point or the x-coordinate of the point. May be a number, a BigNumber, a string (which will be interpreted as hex), a number array, or null. If null, an "Infinity" point is constructed.
     * @param y - If x is not a point, the y-coordinate of the point, similar to x.
     * @param isRed - A boolean indicating if the point is a member of the field of integers modulo the k256 prime. Default is true.
     *
     * @example
     * new PublicKey(point1);
     * new PublicKey('abc123', 'def456');
     */
    constructor(x, y = null, isRed = true) {
      if (x instanceof Point) {
        super(x.getX(), x.getY());
      } else {
        if (y === null && isRed && typeof x === "string") {
          if (x.length === 66 || x.length === 130) {
            throw new Error('You are using the "new PublicKey()" constructor with a DER hex string. You need to use "PublicKey.fromString()" instead.');
          }
        }
        super(x, y, isRed);
      }
    }
    /**
     * Derive a shared secret from a public key and a private key for use in symmetric encryption.
     * This method multiplies the public key (an instance of Point) with a private key.
     *
     * @param priv - The private key to use in deriving the shared secret.
     *
     * @returns Returns the Point representing the shared secret.
     *
     * @throws Will throw an error if the public key is not valid for ECDH secret derivation.
     *
     * @example
     * const myPrivKey = new PrivateKey(...)
     * const sharedSecret = myPubKey.deriveSharedSecret(myPrivKey)
     */
    deriveSharedSecret(priv) {
      if (!this.validate()) {
        throw new Error("Public key not valid for ECDH secret derivation");
      }
      return this.mulCT(priv);
    }
    /**
     * Verify a signature of a message using this public key.
     *
     * @param msg - The message to verify. It can be a string or an array of numbers.
     * @param sig - The Signature of the message that needs verification.
     * @param enc - The encoding of the message. It defaults to 'utf8'.
     *
     * @returns Returns true if the signature is verified successfully, otherwise false.
     *
     * @example
     * const myMessage = "Hello, world!"
     * const mySignature = new Signature(...)
     * const isVerified = myPubKey.verify(myMessage, mySignature)
     */
    verify(msg, sig, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, sig, this);
    }
    /**
     * Encode the public key to DER (Distinguished Encoding Rules) format.
     *
     * @returns Returns the DER-encoded public key in number array or string.
     *
     * @param enc - The encoding of the DER string. undefined = number array, 'hex' = hex string.
     *
     * @example
     * const derPublicKey = myPubKey.toDER()
     */
    toDER(enc) {
      if (enc === "hex")
        return this.encode(true, enc);
      return this.encode(true);
    }
    /**
     * Hash sha256 and ripemd160 of the public key.
     *
     * @returns Returns the hash of the public key.
     *
     * @example
     * const publicKeyHash = pubkey.toHash()
     */
    toHash(enc) {
      const pkh = hash160(this.encode(true));
      if (enc === "hex") {
        return toHex(pkh);
      }
      return pkh;
    }
    /**
     * Base58Check encodes the hash of the public key with a prefix to indicate locking script type.
     * Defaults to P2PKH for mainnet, otherwise known as a "Bitcoin Address".
     *
     * @param prefix defaults to [0x00] for mainnet, set to [0x6f] for testnet or use the strings 'mainnet' or 'testnet'
     *
     * @returns Returns the address encoding associated with the hash of the public key.
     *
     * @example
     * const address = pubkey.toAddress()
     * const address = pubkey.toAddress('mainnet')
     * const testnetAddress = pubkey.toAddress([0x6f])
     * const testnetAddress = pubkey.toAddress('testnet')
     */
    toAddress(prefix = [0]) {
      if (typeof prefix === "string") {
        if (prefix === "testnet" || prefix === "test") {
          prefix = [111];
        } else if (prefix === "mainnet" || prefix === "main") {
          prefix = [0];
        } else {
          throw new Error(`Invalid prefix ${prefix}`);
        }
      }
      return toBase58Check(this.toHash(), prefix);
    }
    /**
     * Derives a child key with BRC-42.
     * @param privateKey The private key of the other party
     * @param invoiceNumber The invoice number used to derive the child key
     * @param cacheSharedSecret Optional function to cache shared secrets
     * @param retrieveCachedSharedSecret Optional function to retrieve shared secrets from the cache
     * @returns The derived child key.
     */
    deriveChild(privateKey, invoiceNumber, cacheSharedSecret, retrieveCachedSharedSecret) {
      let sharedSecret;
      if (typeof retrieveCachedSharedSecret === "function") {
        const retrieved = retrieveCachedSharedSecret(privateKey, this);
        if (typeof retrieved !== "undefined") {
          sharedSecret = retrieved;
        } else {
          sharedSecret = this.deriveSharedSecret(privateKey);
          if (typeof cacheSharedSecret === "function") {
            cacheSharedSecret(privateKey, this, sharedSecret);
          }
        }
      } else {
        sharedSecret = this.deriveSharedSecret(privateKey);
      }
      const invoiceNumberBin = toArray2(invoiceNumber, "utf8");
      const hmac2 = sha256hmac(sharedSecret.encode(true), invoiceNumberBin);
      const curve2 = new Curve();
      const point = curve2.g.mul(new BigNumber(hmac2));
      const finalPoint = this.add(point);
      return new _PublicKey(finalPoint.x, finalPoint.y);
    }
    /**
     * Takes an array of numbers or a string and returns a new PublicKey instance.
     * This method will throw an error if the Compact encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     * compactByte value 27-30 means uncompressed public key.
     * 31-34 means compressed public key.
     * The range represents the recovery param which can be 0,1,2,3.
     *
     * @static
     * @method fromMsgHashAndCompactSignature
     * @param msgHash - The message hash which was signed.
     * @param signature - The signature in compact format.
     * @param enc - The encoding of the signature string.
     * @returns A PublicKey instance derived from the message hash and compact signature.
     * @example
     * const publicKey = Signature.fromMsgHashAndCompactSignature(msgHash, 'IMOl2mVKfDgsSsHT4uIYBNN4e...', 'base64');
     */
    static fromMsgHashAndCompactSignature(msgHash, signature, enc) {
      const data = toArray2(signature, enc);
      if (data.length !== 65) {
        throw new Error("Invalid Compact Signature");
      }
      const compactByte = data[0];
      if (compactByte < 27 || compactByte >= 35) {
        throw new Error("Invalid Compact Byte");
      }
      let r2 = data[0] - 27;
      if (r2 > 3) {
        r2 -= 4;
      }
      const s2 = new Signature(new BigNumber(data.slice(1, 33)), new BigNumber(data.slice(33, 65)));
      return s2.RecoverPublicKey(r2, msgHash);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Random.js
  var Rand = class {
    constructor() {
      __publicField(this, "_rand");
      const noRand = () => {
        throw new Error("No secure random number generator is available in this environment.");
      };
      this._rand = noRand;
      if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(globalThis, n);
        };
        return;
      }
      if (typeof process !== "undefined" && process.release?.name === "node") {
        try {
          const crypto = __require("crypto");
          if (typeof crypto.randomBytes === "function") {
            this._rand = (n) => {
              return Array.from(crypto.randomBytes(n));
            };
            return;
          }
        } catch (e) {
        }
      }
      if (typeof self !== "undefined" && typeof self.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(self, n);
        };
        return;
      }
      if (typeof window !== "undefined" && typeof window.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(window, n);
        };
        return;
      }
      this._rand = noRand;
    }
    // ✅ Explicit function type
    getRandomValues(obj, n) {
      const arr = new Uint8Array(n);
      obj.crypto.getRandomValues(arr);
      return Array.from(arr);
    }
    generate(len) {
      return this._rand(len);
    }
  };
  var ayn = null;
  var Random_default = (len) => {
    if (ayn == null) {
      ayn = new Rand();
    }
    return ayn.generate(len);
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Polynomial.js
  var PointInFiniteField = class _PointInFiniteField {
    constructor(x, y) {
      __publicField(this, "x");
      __publicField(this, "y");
      const P2 = new Curve().p;
      this.x = x.umod(P2);
      this.y = y.umod(P2);
    }
    toString() {
      return toBase58(this.x.toArray()) + "." + toBase58(this.y.toArray());
    }
    static fromString(str) {
      const [x, y] = str.split(".");
      return new _PointInFiniteField(new BigNumber(fromBase58(x)), new BigNumber(fromBase58(y)));
    }
  };
  var Polynomial = class _Polynomial {
    constructor(points, threshold) {
      __publicField(this, "points");
      __publicField(this, "threshold");
      this.points = points;
      this.threshold = threshold ?? points.length;
    }
    static fromPrivateKey(key, threshold) {
      const P2 = new Curve().p;
      const points = [
        new PointInFiniteField(new BigNumber(0), new BigNumber(key.toArray()))
      ];
      for (let i = 1; i < threshold; i++) {
        const randomX = new BigNumber(Random_default(32)).umod(P2);
        const randomY = new BigNumber(Random_default(32)).umod(P2);
        points.push(new PointInFiniteField(randomX, randomY));
      }
      return new _Polynomial(points);
    }
    // Evaluate the polynomial at x by using Lagrange interpolation
    valueAt(x) {
      const P2 = new Curve().p;
      let y = new BigNumber(0);
      for (let i = 0; i < this.threshold; i++) {
        let term = this.points[i].y;
        for (let j = 0; j < this.threshold; j++) {
          if (i !== j) {
            const xj = this.points[j].x;
            const xi = this.points[i].x;
            const numerator = x.sub(xj).umod(P2);
            const denominator = xi.sub(xj).umod(P2);
            const denominatorInverse = denominator.invm(P2);
            const fraction = numerator.mul(denominatorInverse).umod(P2);
            term = term.mul(fraction).umod(P2);
          }
        }
        y = y.add(term).umod(P2);
      }
      return y;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/PrivateKey.js
  var KeyShares = class _KeyShares {
    constructor(points, threshold, integrity) {
      __publicField(this, "points");
      __publicField(this, "threshold");
      __publicField(this, "integrity");
      this.points = points;
      this.threshold = threshold;
      this.integrity = integrity;
    }
    static fromBackupFormat(shares) {
      let threshold = 0;
      let integrity = "";
      const points = shares.map((share, idx) => {
        const shareParts = share.split(".");
        if (shareParts.length !== 4) {
          throw new Error("Invalid share format in share " + idx.toString() + '. Expected format: "x.y.t.i" - received ' + share);
        }
        const [x, y, t, i] = shareParts;
        if (t === void 0)
          throw new Error("Threshold not found in share " + idx.toString());
        if (i === void 0)
          throw new Error("Integrity not found in share " + idx.toString());
        const tInt = parseInt(t);
        if (idx !== 0 && threshold !== tInt) {
          throw new Error("Threshold mismatch in share " + idx.toString());
        }
        if (idx !== 0 && integrity !== i) {
          throw new Error("Integrity mismatch in share " + idx.toString());
        }
        threshold = tInt;
        integrity = i;
        return PointInFiniteField.fromString([x, y].join("."));
      });
      return new _KeyShares(points, threshold, integrity);
    }
    toBackupFormat() {
      return this.points.map((share) => share.toString() + "." + this.threshold.toString() + "." + this.integrity);
    }
  };
  var PrivateKey = class _PrivateKey extends BigNumber {
    /**
     * Generates a private key randomly.
     *
     * @method fromRandom
     * @static
     * @returns The newly generated Private Key.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     */
    static fromRandom() {
      return new _PrivateKey(Random_default(32));
    }
    /**
     * Generates a private key from a string.
     *
     * @method fromString
     * @static
     * @param str - The string to generate the private key from.
     * @param base - The base of the string.
     * @returns The generated Private Key.
     * @throws Will throw an error if the string is not valid.
     **/
    static fromString(str, base = "hex") {
      return new _PrivateKey(super.fromString(str, base).toArray());
    }
    /**
     * Generates a private key from a hexadecimal string.
     *
     * @method fromHex
     * @static
     * @param {string} str - The hexadecimal string representing the private key. The string must represent a valid private key in big-endian format.
     * @returns {PrivateKey} The generated Private Key instance.
     * @throws {Error} If the string is not a valid hexadecimal or represents an invalid private key.
     **/
    static fromHex(str) {
      return new _PrivateKey(super.fromHex(str, "big"));
    }
    /**
     * Generates a private key from a WIF (Wallet Import Format) string.
     *
     * @method fromWif
     * @static
     * @param wif - The WIF string to generate the private key from.
     * @param base - The base of the string.
     * @returns The generated Private Key.
     * @throws Will throw an error if the string is not a valid WIF.
     **/
    static fromWif(wif, prefixLength = 1) {
      const decoded = fromBase58Check(wif, void 0, prefixLength);
      if (decoded.data.length !== 33) {
        throw new Error("Invalid WIF length");
      }
      if (decoded.data[32] !== 1) {
        throw new Error("Invalid WIF padding");
      }
      return new _PrivateKey(decoded.data.slice(0, 32));
    }
    /**
     * @constructor
     *
     * @param number - The number (various types accepted) to construct a BigNumber from. Default is 0.
     *
     * @param base - The base of number provided. By default is 10. Ignored if number is BigNumber.
     *
     * @param endian - The endianness provided. By default is 'big endian'. Ignored if number is BigNumber.
     *
     * @param modN - Optional. Default 'apply. If 'apply', apply modN to input to guarantee a valid PrivateKey. If 'error', if input is out of field throw new Error('Input is out of field'). If 'nocheck', assumes input is in field.
     *
     * @example
     * import PrivateKey from './PrivateKey';
     * import BigNumber from './BigNumber';
     * const privKey = new PrivateKey(new BigNumber('123456', 10, 'be'));
     */
    constructor(number = 0, base = 10, endian = "be", modN2 = "apply") {
      if (number instanceof BigNumber) {
        super();
        number.copy(this);
      } else {
        super(number, base, endian);
      }
      if (modN2 !== "nocheck") {
        const check = this.checkInField();
        if (!check.inField) {
          if (modN2 === "error") {
            throw new Error("Input is out of field");
          }
          BigNumber.move(this, check.modN);
        }
      }
    }
    /**
     * A utility function to check that the value of this PrivateKey lies in the field limited by curve.n
     * @returns { inField, modN } where modN is this PrivateKey's current BigNumber value mod curve.n, and inField is true only if modN equals current BigNumber value.
     */
    checkInField() {
      const curve2 = new Curve();
      const modN2 = this.mod(curve2.n);
      const inField = this.cmp(modN2) === 0;
      return { inField, modN: modN2 };
    }
    /**
     * @returns true if the PrivateKey's current BigNumber value lies in the field limited by curve.n
     */
    isValid() {
      return this.checkInField().inField;
    }
    /**
     * Signs a message using the private key.
     *
     * @method sign
     * @param msg - The message (array of numbers or string) to be signed.
     * @param enc - If 'hex' the string will be treated as hex, utf8 otherwise.
     * @param forceLowS - If true (the default), the signature will be forced to have a low S value.
     * @param customK — If provided, uses a custom K-value for the signature. Provie a function that returns a BigNumber, or the BigNumber itself.
     * @returns A digital signature generated from the hash of the message and the private key.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const signature = privateKey.sign('Hello, World!');
     */
    sign(msg, enc, forceLowS = true, customK) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return sign(msgHash, this, forceLowS, customK);
    }
    /**
     * Verifies a message's signature using the public key associated with this private key.
     *
     * @method verify
     * @param msg - The original message which has been signed.
     * @param sig - The signature to be verified.
     * @param enc - The data encoding method.
     * @returns Whether or not the signature is valid.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const signature = privateKey.sign('Hello, World!');
     * const isSignatureValid = privateKey.verify('Hello, World!', signature);
     */
    verify(msg, sig, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, sig, this.toPublicKey());
    }
    /**
     * Converts the private key to its corresponding public key.
     *
     * The public key is generated by multiplying the base point G of the curve and the private key.
     *
     * @method toPublicKey
     * @returns The generated PublicKey.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const publicKey = privateKey.toPublicKey();
     */
    toPublicKey() {
      const c = new Curve();
      const p = c.g.mulCT(this);
      return new PublicKey(p.x, p.y);
    }
    /**
     * Converts the private key to a Wallet Import Format (WIF) string.
     *
     * Base58Check encoding is used for encoding the private key.
     * The prefix
     *
     * @method toWif
     * @returns The WIF string.
     *
     * @param prefix defaults to [0x80] for mainnet, set it to [0xef] for testnet.
     *
     * @throws Error('Value is out of field') if current BigNumber value is out of field limited by curve.n
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const wif = privateKey.toWif();
     * const testnetWif = privateKey.toWif([0xef]);
     */
    toWif(prefix = [128]) {
      if (!this.isValid()) {
        throw new Error("Value is out of field");
      }
      return toBase58Check([...this.toArray("be", 32), 1], prefix);
    }
    /**
     * Base58Check encodes the hash of the public key associated with this private key with a prefix to indicate locking script type.
     * Defaults to P2PKH for mainnet, otherwise known as a "Bitcoin Address".
     *
     * @param prefix defaults to [0x00] for mainnet, set to [0x6f] for testnet or use the strings 'testnet' or 'mainnet'
     *
     * @returns Returns the address encoding associated with the hash of the public key associated with this private key.
     *
     * @example
     * const address = privkey.toAddress()
     * const address = privkey.toAddress('mainnet')
     * const testnetAddress = privkey.toAddress([0x6f])
     * const testnetAddress = privkey.toAddress('testnet')
     */
    toAddress(prefix = [0]) {
      return this.toPublicKey().toAddress(prefix);
    }
    /**
     * Converts this PrivateKey to a hexadecimal string.
     *
     * @method toHex
     * @param length - The minimum length of the hex string
     * @returns Returns a string representing the hexadecimal value of this BigNumber.
     *
     * @example
     * const bigNumber = new BigNumber(255);
     * const hex = bigNumber.toHex();
     */
    toHex() {
      return super.toHex(32);
    }
    /**
     * Converts this PrivateKey to a string representation.
     *
     * @method toString
     * @param {number | 'hex'} [base='hex'] - The base for representing the number. Default is hexadecimal ('hex').
     * @param {number} [padding=64] - The minimum number of digits for the output string. Default is 64, ensuring a 256-bit representation in hexadecimal.
     * @returns {string} A string representation of the PrivateKey in the specified base, padded to the specified length.
     *
     **/
    toString(base = "hex", padding = 64) {
      return super.toString(base, padding);
    }
    /**
     * Derives a shared secret from the public key.
     *
     * @method deriveSharedSecret
     * @param key - The public key to derive the shared secret from.
     * @returns The derived shared secret (a point on the curve).
     * @throws Will throw an error if the public key is not valid.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const publicKey = privateKey.toPublicKey();
     * const sharedSecret = privateKey.deriveSharedSecret(publicKey);
     */
    deriveSharedSecret(key) {
      if (!key.validate()) {
        throw new Error("Public key not valid for ECDH secret derivation");
      }
      return key.mulCT(this);
    }
    /**
     * SECURITY NOTE – DETERMINISTIC CHILD KEY DERIVATION
     *
     * This method derives child private keys deterministically from the caller’s
     * long-term private key, the counterparty’s public key, and a caller-supplied
     * invoice number using HMAC over an ECDH shared secret (BRC-42 style derivation).
     *
     * This construction does NOT implement a formally authenticated key exchange
     * (AKE) and does NOT provide the following security properties:
     *
     *  - Forward secrecy: Compromise of a long-term private key compromises all
     *    past and future child keys derived from it.
     *  - Replay protection: Child keys are deterministic for a given invoice
     *    number and key pair; previously observed messages can be replayed.
     *  - Explicit authentication / identity binding: Possession of a public key
     *    alone does not guarantee the intended peer identity, enabling potential
     *    identity misbinding attacks if higher-level identity verification is absent.
     *
     * This derivation is intended for lightweight, deterministic key hierarchies
     * where both parties already possess and trust each other’s long-term public
     * keys. It SHOULD NOT be used as a drop-in replacement for a standard
     * authenticated key exchange (e.g. X3DH, Noise, or SIGMA) in high-security or
     * high-value contexts.
     *
     * Any future protocol providing forward secrecy, replay protection, or strong
     * peer authentication will require a versioned, breaking change.
     */
    /**
     * Derives a child key with BRC-42.
     * @param publicKey The public key of the other party
     * @param invoiceNumber The invoice number used to derive the child key
     * @param cacheSharedSecret Optional function to cache shared secrets
     * @param retrieveCachedSharedSecret Optional function to retrieve shared secrets from the cache
     * @returns The derived child key.
     */
    deriveChild(publicKey, invoiceNumber, cacheSharedSecret, retrieveCachedSharedSecret) {
      let sharedSecret;
      if (typeof retrieveCachedSharedSecret === "function") {
        const retrieved = retrieveCachedSharedSecret(this, publicKey);
        if (typeof retrieved !== "undefined") {
          sharedSecret = retrieved;
        } else {
          sharedSecret = this.deriveSharedSecret(publicKey);
          if (typeof cacheSharedSecret === "function") {
            cacheSharedSecret(this, publicKey, sharedSecret);
          }
        }
      } else {
        sharedSecret = this.deriveSharedSecret(publicKey);
      }
      const invoiceNumberBin = toArray2(invoiceNumber, "utf8");
      const hmac2 = sha256hmac(sharedSecret.encode(true), invoiceNumberBin);
      const curve2 = new Curve();
      return new _PrivateKey(this.add(new BigNumber(hmac2)).mod(curve2.n).toArray());
    }
    /**
     * Splits the private key into shares using Shamir's Secret Sharing Scheme.
     *
     * @param threshold The minimum number of shares required to reconstruct the private key.
     * @param totalShares The total number of shares to generate.
     * @param prime The prime number to be used in Shamir's Secret Sharing Scheme.
     * @returns An array of shares.
     *
     * @example
     * const key = PrivateKey.fromRandom()
     * const shares = key.toKeyShares(2, 5)
     */
    toKeyShares(threshold, totalShares) {
      if (typeof threshold !== "number" || typeof totalShares !== "number") {
        throw new Error("threshold and totalShares must be numbers");
      }
      if (threshold < 2)
        throw new Error("threshold must be at least 2");
      if (totalShares < 2)
        throw new Error("totalShares must be at least 2");
      if (threshold > totalShares) {
        throw new Error("threshold should be less than or equal to totalShares");
      }
      const poly = Polynomial.fromPrivateKey(this, threshold);
      const points = [];
      const usedXCoordinates = /* @__PURE__ */ new Set();
      const curve2 = new Curve();
      const seed = Random_default(64);
      for (let i = 0; i < totalShares; i++) {
        let x;
        let attempts = 0;
        do {
          const counter = [i, attempts, ...Random_default(32)];
          const h = sha512hmac(seed, counter);
          x = new BigNumber(h).umod(curve2.p);
          attempts++;
          if (attempts > 5) {
            throw new Error("Failed to generate unique x coordinate after 5 attempts");
          }
        } while (x.isZero() || usedXCoordinates.has(x.toString()));
        usedXCoordinates.add(x.toString());
        const y = poly.valueAt(x);
        points.push(new PointInFiniteField(x, y));
      }
      const integrity = this.toPublicKey().toHash("hex").slice(0, 8);
      return new KeyShares(points, threshold, integrity);
    }
    /**
     * @method toBackupShares
     *
     * Creates a backup of the private key by splitting it into shares.
     *
     *
     * @param threshold The number of shares which will be required to reconstruct the private key.
     * @param totalShares The number of shares to generate for distribution.
     * @returns
     */
    toBackupShares(threshold, totalShares) {
      return this.toKeyShares(threshold, totalShares).toBackupFormat();
    }
    /**
     *
     * @method fromBackupShares
     *
     * Creates a private key from backup shares.
     *
     * @param shares
     * @returns PrivateKey
     *
     * @example
     *
     * const share1 = '3znuzt7DZp8HzZTfTh5MF9YQKNX3oSxTbSYmSRGrH2ev.2Nm17qoocmoAhBTCs8TEBxNXCskV9N41rB2PckcgYeqV.2.35449bb9'
     * const share2 = 'Cm5fuUc39X5xgdedao8Pr1kvCSm8Gk7Cfenc7xUKcfLX.2juyK9BxCWn2DiY5JUAgj9NsQ77cc9bWksFyW45haXZm.2.35449bb9'
     *
     * const recoveredKey = PrivateKey.fromBackupShares([share1, share2])
     */
    static fromBackupShares(shares) {
      return _PrivateKey.fromKeyShares(KeyShares.fromBackupFormat(shares));
    }
    /**
     * Combines shares to reconstruct the private key.
     *
     * @param shares An array of points (shares) to be used to reconstruct the private key.
     * @param threshold The minimum number of shares required to reconstruct the private key.
     *
     * @returns The reconstructed private key.
     *
     **/
    static fromKeyShares(keyShares) {
      const { points, threshold, integrity } = keyShares;
      if (threshold < 2)
        throw new Error("threshold must be at least 2");
      if (points.length < threshold) {
        throw new Error(`At least ${threshold} shares are required to reconstruct the private key`);
      }
      for (let i = 0; i < threshold; i++) {
        for (let j = i + 1; j < threshold; j++) {
          if (points[i].x.eq(points[j].x)) {
            throw new Error("Duplicate share detected, each must be unique.");
          }
        }
      }
      const poly = new Polynomial(points, threshold);
      const privateKey = new _PrivateKey(poly.valueAt(new BigNumber(0)).toArray());
      const integrityHash = privateKey.toPublicKey().toHash("hex").slice(0, 8);
      if (integrityHash !== integrity) {
        throw new Error("Integrity hash mismatch");
      }
      return privateKey;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/AESGCM.js
  var SBox = new Uint8Array([
    99,
    124,
    119,
    123,
    242,
    107,
    111,
    197,
    48,
    1,
    103,
    43,
    254,
    215,
    171,
    118,
    202,
    130,
    201,
    125,
    250,
    89,
    71,
    240,
    173,
    212,
    162,
    175,
    156,
    164,
    114,
    192,
    183,
    253,
    147,
    38,
    54,
    63,
    247,
    204,
    52,
    165,
    229,
    241,
    113,
    216,
    49,
    21,
    4,
    199,
    35,
    195,
    24,
    150,
    5,
    154,
    7,
    18,
    128,
    226,
    235,
    39,
    178,
    117,
    9,
    131,
    44,
    26,
    27,
    110,
    90,
    160,
    82,
    59,
    214,
    179,
    41,
    227,
    47,
    132,
    83,
    209,
    0,
    237,
    32,
    252,
    177,
    91,
    106,
    203,
    190,
    57,
    74,
    76,
    88,
    207,
    208,
    239,
    170,
    251,
    67,
    77,
    51,
    133,
    69,
    249,
    2,
    127,
    80,
    60,
    159,
    168,
    81,
    163,
    64,
    143,
    146,
    157,
    56,
    245,
    188,
    182,
    218,
    33,
    16,
    255,
    243,
    210,
    205,
    12,
    19,
    236,
    95,
    151,
    68,
    23,
    196,
    167,
    126,
    61,
    100,
    93,
    25,
    115,
    96,
    129,
    79,
    220,
    34,
    42,
    144,
    136,
    70,
    238,
    184,
    20,
    222,
    94,
    11,
    219,
    224,
    50,
    58,
    10,
    73,
    6,
    36,
    92,
    194,
    211,
    172,
    98,
    145,
    149,
    228,
    121,
    231,
    200,
    55,
    109,
    141,
    213,
    78,
    169,
    108,
    86,
    244,
    234,
    101,
    122,
    174,
    8,
    186,
    120,
    37,
    46,
    28,
    166,
    180,
    198,
    232,
    221,
    116,
    31,
    75,
    189,
    139,
    138,
    112,
    62,
    181,
    102,
    72,
    3,
    246,
    14,
    97,
    53,
    87,
    185,
    134,
    193,
    29,
    158,
    225,
    248,
    152,
    17,
    105,
    217,
    142,
    148,
    155,
    30,
    135,
    233,
    206,
    85,
    40,
    223,
    140,
    161,
    137,
    13,
    191,
    230,
    66,
    104,
    65,
    153,
    45,
    15,
    176,
    84,
    187,
    22
  ]);
  var Rcon = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [2, 0, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [16, 0, 0, 0],
    [32, 0, 0, 0],
    [64, 0, 0, 0],
    [128, 0, 0, 0],
    [27, 0, 0, 0],
    [54, 0, 0, 0]
  ].map((v) => new Uint8Array(v));
  var mul2 = new Uint8Array(256);
  var mul3 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const m2 = (i << 1 ^ ((i & 128) !== 0 ? 27 : 0)) & 255;
    mul2[i] = m2;
    mul3[i] = m2 ^ i;
  }
  var R = (() => {
    const r2 = new Uint8Array(16);
    r2[0] = 225;
    return r2;
  })();

  // node_modules/@bsv/sdk/dist/esm/src/primitives/TransactionSignature.js
  var EMPTY_SCRIPT = new Uint8Array(0);
  var _TransactionSignature = class _TransactionSignature extends Signature {
    constructor(r2, s2, scope) {
      super(r2, s2);
      __publicField(this, "scope");
      this.scope = scope;
    }
    /**
     * Formats the SIGHASH preimage for the targeted input, optionally using a cache to skip recomputing shared hash prefixes.
     * @param params - Context for the signing input plus transaction metadata.
     * @param params.cache - Optional cache storing previously computed `hashPrevouts`, `hashSequence`, or `hashOutputs*` values; it will be populated if present.
     */
    static format(params) {
      return Array.from(this.formatBytes(params));
    }
    /**
     * Formats the same SIGHASH preimage bytes as `format`, supporting the optional cache for hash reuse.
     * @param params - Context for the signing operation.
     * @param params.cache - Optional `SignatureHashCache` that may already contain hashed prefixes and is populated during formatting.
     * @returns Bytes for signing.
     */
    static formatBytes(params) {
      const cache = params.cache;
      const currentInput = {
        sourceTXID: params.sourceTXID,
        sourceOutputIndex: params.sourceOutputIndex,
        sequence: params.inputSequence
      };
      const inputs = [...params.otherInputs];
      inputs.splice(params.inputIndex, 0, currentInput);
      const getPrevoutHash = () => {
        const writer2 = new Writer();
        for (const input of inputs) {
          if (typeof input.sourceTXID === "undefined") {
            if (input.sourceTransaction == null) {
              throw new Error("Missing sourceTransaction for input");
            }
            writer2.write(input.sourceTransaction.hash());
          } else {
            writer2.writeReverse(toArray2(input.sourceTXID, "hex"));
          }
          writer2.writeUInt32LE(input.sourceOutputIndex);
        }
        return hash256(writer2.toUint8Array());
      };
      const getSequenceHash = () => {
        const writer2 = new Writer();
        for (const input of inputs) {
          const sequence = input.sequence ?? 4294967295;
          writer2.writeUInt32LE(sequence);
        }
        return hash256(writer2.toUint8Array());
      };
      function getOutputsHash(outputIndex) {
        const writer2 = new Writer();
        if (typeof outputIndex === "undefined") {
          for (const output of params.outputs) {
            const satoshis = output.satoshis ?? 0;
            writer2.writeUInt64LE(satoshis);
            const script = output.lockingScript?.toUint8Array() ?? EMPTY_SCRIPT;
            writer2.writeVarIntNum(script.length);
            writer2.write(script);
          }
        } else {
          const output = params.outputs[outputIndex];
          if (output === void 0) {
            throw new Error(`Output at index ${outputIndex} does not exist`);
          }
          const satoshis = output.satoshis ?? 0;
          writer2.writeUInt64LE(satoshis);
          const script = output.lockingScript?.toUint8Array() ?? EMPTY_SCRIPT;
          writer2.writeVarIntNum(script.length);
          writer2.write(script);
        }
        return hash256(writer2.toUint8Array());
      }
      let hashPrevouts = new Array(32).fill(0);
      let hashSequence = new Array(32).fill(0);
      let hashOutputs = new Array(32).fill(0);
      if ((params.scope & _TransactionSignature.SIGHASH_ANYONECANPAY) === 0) {
        if (cache?.hashPrevouts != null) {
          hashPrevouts = cache.hashPrevouts;
        } else {
          hashPrevouts = getPrevoutHash();
          if (cache != null)
            cache.hashPrevouts = hashPrevouts;
        }
      }
      if ((params.scope & _TransactionSignature.SIGHASH_ANYONECANPAY) === 0 && (params.scope & 31) !== _TransactionSignature.SIGHASH_SINGLE && (params.scope & 31) !== _TransactionSignature.SIGHASH_NONE) {
        if (cache?.hashSequence != null) {
          hashSequence = cache.hashSequence;
        } else {
          hashSequence = getSequenceHash();
          if (cache != null)
            cache.hashSequence = hashSequence;
        }
      }
      if ((params.scope & 31) !== _TransactionSignature.SIGHASH_SINGLE && (params.scope & 31) !== _TransactionSignature.SIGHASH_NONE) {
        if (cache?.hashOutputsAll != null) {
          hashOutputs = cache.hashOutputsAll;
        } else {
          hashOutputs = getOutputsHash();
          if (cache != null)
            cache.hashOutputsAll = hashOutputs;
        }
      } else if ((params.scope & 31) === _TransactionSignature.SIGHASH_SINGLE && params.inputIndex < params.outputs.length) {
        const key = params.inputIndex;
        const cachedSingle = cache?.hashOutputsSingle?.get(key);
        if (cachedSingle != null) {
          hashOutputs = cachedSingle;
        } else {
          hashOutputs = getOutputsHash(key);
          if (cache != null) {
            if (cache.hashOutputsSingle == null)
              cache.hashOutputsSingle = /* @__PURE__ */ new Map();
            cache.hashOutputsSingle.set(key, hashOutputs);
          }
        }
      }
      const writer = new Writer();
      writer.writeInt32LE(params.transactionVersion);
      writer.write(hashPrevouts);
      writer.write(hashSequence);
      writer.writeReverse(toArray2(params.sourceTXID, "hex"));
      writer.writeUInt32LE(params.sourceOutputIndex);
      const subscriptBin = params.subscript.toUint8Array();
      writer.writeVarIntNum(subscriptBin.length);
      writer.write(subscriptBin);
      writer.writeUInt64LE(params.sourceSatoshis);
      const sequenceNumber = currentInput.sequence;
      writer.writeUInt32LE(sequenceNumber);
      writer.write(hashOutputs);
      writer.writeUInt32LE(params.lockTime);
      writer.writeUInt32LE(params.scope >>> 0);
      return writer.toUint8Array();
    }
    // The format used in a tx
    static fromChecksigFormat(buf) {
      if (buf.length === 0) {
        const r2 = new BigNumber(1);
        const s2 = new BigNumber(1);
        const scope2 = 1;
        return new _TransactionSignature(r2, s2, scope2);
      }
      const scope = buf[buf.length - 1];
      const derbuf = buf.slice(0, buf.length - 1);
      const tempSig = Signature.fromDER(derbuf);
      return new _TransactionSignature(tempSig.r, tempSig.s, scope);
    }
    /**
     * Compares to bitcoind's IsLowDERSignature
     * See also Ecdsa signature algorithm which enforces this.
     * See also Bip 62, "low S values in signatures"
     */
    hasLowS() {
      if (this.s.ltn(1) || this.s.gt(new BigNumber("7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0", "hex"))) {
        return false;
      }
      return true;
    }
    toChecksigFormat() {
      const derbuf = this.toDER();
      return [...derbuf, this.scope];
    }
  };
  __publicField(_TransactionSignature, "SIGHASH_ALL", 1);
  __publicField(_TransactionSignature, "SIGHASH_NONE", 2);
  __publicField(_TransactionSignature, "SIGHASH_SINGLE", 3);
  __publicField(_TransactionSignature, "SIGHASH_FORKID", 64);
  __publicField(_TransactionSignature, "SIGHASH_ANYONECANPAY", 128);
  var TransactionSignature = _TransactionSignature;

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Secp256r1.js
  var P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  var N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  var A = P - 3n;
  var B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
  var GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
  var GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
  var HALF_N = N >> 1n;

  // node_modules/@bsv/sdk/dist/esm/src/script/OP.js
  var OP = {
    // push value
    OP_FALSE: 0,
    OP_0: 0,
    OP_PUSHDATA1: 76,
    OP_PUSHDATA2: 77,
    OP_PUSHDATA4: 78,
    OP_1NEGATE: 79,
    OP_RESERVED: 80,
    OP_TRUE: 81,
    OP_1: 81,
    OP_2: 82,
    OP_3: 83,
    OP_4: 84,
    OP_5: 85,
    OP_6: 86,
    OP_7: 87,
    OP_8: 88,
    OP_9: 89,
    OP_10: 90,
    OP_11: 91,
    OP_12: 92,
    OP_13: 93,
    OP_14: 94,
    OP_15: 95,
    OP_16: 96,
    // control
    OP_NOP: 97,
    OP_VER: 98,
    OP_IF: 99,
    OP_NOTIF: 100,
    OP_VERIF: 101,
    OP_VERNOTIF: 102,
    OP_ELSE: 103,
    OP_ENDIF: 104,
    OP_VERIFY: 105,
    OP_RETURN: 106,
    // stack ops
    OP_TOALTSTACK: 107,
    OP_FROMALTSTACK: 108,
    OP_2DROP: 109,
    OP_2DUP: 110,
    OP_3DUP: 111,
    OP_2OVER: 112,
    OP_2ROT: 113,
    OP_2SWAP: 114,
    OP_IFDUP: 115,
    OP_DEPTH: 116,
    OP_DROP: 117,
    OP_DUP: 118,
    OP_NIP: 119,
    OP_OVER: 120,
    OP_PICK: 121,
    OP_ROLL: 122,
    OP_ROT: 123,
    OP_SWAP: 124,
    OP_TUCK: 125,
    // data manipulation ops
    OP_CAT: 126,
    OP_SUBSTR: 127,
    // Replaced in BSV
    OP_SPLIT: 127,
    OP_LEFT: 128,
    // Replaced in BSV
    OP_NUM2BIN: 128,
    OP_RIGHT: 129,
    // Replaced in BSV
    OP_BIN2NUM: 129,
    OP_SIZE: 130,
    // bit logic
    OP_INVERT: 131,
    OP_AND: 132,
    OP_OR: 133,
    OP_XOR: 134,
    OP_EQUAL: 135,
    OP_EQUALVERIFY: 136,
    OP_RESERVED1: 137,
    OP_RESERVED2: 138,
    // numeric
    OP_1ADD: 139,
    OP_1SUB: 140,
    OP_2MUL: 141,
    OP_2DIV: 142,
    OP_NEGATE: 143,
    OP_ABS: 144,
    OP_NOT: 145,
    OP_0NOTEQUAL: 146,
    OP_ADD: 147,
    OP_SUB: 148,
    OP_MUL: 149,
    OP_DIV: 150,
    OP_MOD: 151,
    OP_LSHIFT: 152,
    OP_RSHIFT: 153,
    OP_BOOLAND: 154,
    OP_BOOLOR: 155,
    OP_NUMEQUAL: 156,
    OP_NUMEQUALVERIFY: 157,
    OP_NUMNOTEQUAL: 158,
    OP_LESSTHAN: 159,
    OP_GREATERTHAN: 160,
    OP_LESSTHANOREQUAL: 161,
    OP_GREATERTHANOREQUAL: 162,
    OP_MIN: 163,
    OP_MAX: 164,
    OP_WITHIN: 165,
    // crypto
    OP_RIPEMD160: 166,
    OP_SHA1: 167,
    OP_SHA256: 168,
    OP_HASH160: 169,
    OP_HASH256: 170,
    OP_CODESEPARATOR: 171,
    OP_CHECKSIG: 172,
    OP_CHECKSIGVERIFY: 173,
    OP_CHECKMULTISIG: 174,
    OP_CHECKMULTISIGVERIFY: 175,
    // expansion
    OP_NOP1: 176,
    OP_NOP2: 177,
    OP_NOP3: 178,
    OP_NOP4: 179,
    OP_NOP5: 180,
    OP_NOP6: 181,
    OP_NOP7: 182,
    OP_NOP8: 183,
    OP_NOP9: 184,
    OP_NOP10: 185,
    OP_NOP11: 186,
    OP_NOP12: 187,
    OP_NOP13: 188,
    OP_NOP14: 189,
    OP_NOP15: 190,
    OP_NOP16: 191,
    OP_NOP17: 192,
    OP_NOP18: 193,
    OP_NOP19: 194,
    OP_NOP20: 195,
    OP_NOP21: 196,
    OP_NOP22: 197,
    OP_NOP23: 198,
    OP_NOP24: 199,
    OP_NOP25: 200,
    OP_NOP26: 201,
    OP_NOP27: 202,
    OP_NOP28: 203,
    OP_NOP29: 204,
    OP_NOP30: 205,
    OP_NOP31: 206,
    OP_NOP32: 207,
    OP_NOP33: 208,
    OP_NOP34: 209,
    OP_NOP35: 210,
    OP_NOP36: 211,
    OP_NOP37: 212,
    OP_NOP38: 213,
    OP_NOP39: 214,
    OP_NOP40: 215,
    OP_NOP41: 216,
    OP_NOP42: 217,
    OP_NOP43: 218,
    OP_NOP44: 219,
    OP_NOP45: 220,
    OP_NOP46: 221,
    OP_NOP47: 222,
    OP_NOP48: 223,
    OP_NOP49: 224,
    OP_NOP50: 225,
    OP_NOP51: 226,
    OP_NOP52: 227,
    OP_NOP53: 228,
    OP_NOP54: 229,
    OP_NOP55: 230,
    OP_NOP56: 231,
    OP_NOP57: 232,
    OP_NOP58: 233,
    OP_NOP59: 234,
    OP_NOP60: 235,
    OP_NOP61: 236,
    OP_NOP62: 237,
    OP_NOP63: 238,
    OP_NOP64: 239,
    OP_NOP65: 240,
    OP_NOP66: 241,
    OP_NOP67: 242,
    OP_NOP68: 243,
    OP_NOP69: 244,
    OP_NOP70: 245,
    OP_NOP71: 246,
    OP_NOP72: 247,
    OP_NOP73: 248,
    OP_NOP77: 252,
    // template matching params
    OP_SMALLDATA: 249,
    OP_SMALLINTEGER: 250,
    OP_PUBKEYS: 251,
    OP_PUBKEYHASH: 253,
    OP_PUBKEY: 254,
    OP_INVALIDOPCODE: 255
  };
  for (const name in OP) {
    OP[OP[name]] = name;
  }
  var OP_default = OP;

  // node_modules/@bsv/sdk/dist/esm/src/script/Script.js
  var BufferCtor3 = typeof globalThis !== "undefined" ? globalThis.Buffer : void 0;
  var Script = class _Script {
    /**
     * @constructor
     * Constructs a new Script object.
     * @param chunks=[] - An array of script chunks to directly initialize the script.
     * @param rawBytesCache - Optional serialized bytes that can be reused instead of reserializing `chunks`.
     * @param hexCache - Optional lowercase hex string that matches the serialized bytes, used to satisfy `toHex` quickly.
     * @param parsed - When false the script defers parsing `rawBytesCache` until `chunks` is accessed; defaults to true.
     */
    constructor(chunks = [], rawBytesCache, hexCache, parsed = true) {
      __publicField(this, "_chunks");
      __publicField(this, "parsed");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      this._chunks = chunks;
      this.parsed = parsed;
      this.rawBytesCache = rawBytesCache;
      this.hexCache = hexCache;
    }
    /**
     * @method fromASM
     * Static method to construct a Script instance from an ASM (Assembly) formatted string.
     * @param asm - The script in ASM string format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromASM("OP_DUP OP_HASH160 abcd... OP_EQUALVERIFY OP_CHECKSIG")
     */
    static fromASM(asm) {
      const chunks = [];
      const tokens = asm.split(" ");
      let i = 0;
      while (i < tokens.length) {
        const token = tokens[i];
        let opCode;
        let opCodeNum = 0;
        if (token.startsWith("OP_") && typeof OP_default[token] !== "undefined") {
          opCode = token;
          opCodeNum = OP_default[token];
        }
        if (token === "0") {
          opCodeNum = 0;
          chunks.push({
            op: opCodeNum
          });
          i = i + 1;
        } else if (token === "-1") {
          opCodeNum = OP_default.OP_1NEGATE;
          chunks.push({
            op: opCodeNum
          });
          i = i + 1;
        } else if (opCode === void 0) {
          let hex = tokens[i];
          if (hex.length % 2 !== 0) {
            hex = "0" + hex;
          }
          const arr = toArray2(hex, "hex");
          if (encode(arr, "hex") !== hex) {
            throw new Error("invalid hex string in script");
          }
          const len = arr.length;
          if (len >= 0 && len < OP_default.OP_PUSHDATA1) {
            opCodeNum = len;
          } else if (len < Math.pow(2, 8)) {
            opCodeNum = OP_default.OP_PUSHDATA1;
          } else if (len < Math.pow(2, 16)) {
            opCodeNum = OP_default.OP_PUSHDATA2;
          } else if (len < Math.pow(2, 32)) {
            opCodeNum = OP_default.OP_PUSHDATA4;
          }
          chunks.push({
            data: arr,
            op: opCodeNum
          });
          i = i + 1;
        } else if (opCodeNum === OP_default.OP_PUSHDATA1 || opCodeNum === OP_default.OP_PUSHDATA2 || opCodeNum === OP_default.OP_PUSHDATA4) {
          chunks.push({
            data: toArray2(tokens[i + 2], "hex"),
            op: opCodeNum
          });
          i = i + 3;
        } else {
          chunks.push({
            op: opCodeNum
          });
          i = i + 1;
        }
      }
      return new _Script(chunks);
    }
    /**
     * @method fromHex
     * Static method to construct a Script instance from a hexadecimal string.
     * @param hex - The script in hexadecimal format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromHex("76a9...");
     */
    static fromHex(hex) {
      if (hex.length === 0)
        return _Script.fromBinary([]);
      if (hex.length % 2 !== 0) {
        throw new Error("There is an uneven number of characters in the string which suggests it is not hex encoded.");
      }
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error("Some elements in this string are not hex encoded.");
      }
      const bin = toArray2(hex, "hex");
      const rawBytes = Uint8Array.from(bin);
      return new _Script([], rawBytes, hex.toLowerCase(), false);
    }
    /**
     * @method fromBinary
     * Static method to construct a Script instance from a binary array.
     * @param bin - The script in binary array format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromBinary([0x76, 0xa9, ...])
     */
    static fromBinary(bin) {
      const rawBytes = Uint8Array.from(bin);
      return new _Script([], rawBytes, void 0, false);
    }
    get chunks() {
      this.ensureParsed();
      return this._chunks;
    }
    set chunks(value) {
      this._chunks = value;
      this.parsed = true;
      this.invalidateSerializationCaches();
    }
    ensureParsed() {
      if (this.parsed)
        return;
      if (this.rawBytesCache != null) {
        this._chunks = _Script.parseChunks(this.rawBytesCache);
      } else {
        this._chunks = [];
      }
      this.parsed = true;
    }
    /**
     * @method toASM
     * Serializes the script to an ASM formatted string.
     * @returns The script in ASM string format.
     */
    toASM() {
      let str = "";
      for (let i = 0; i < this.chunks.length; i++) {
        const chunk = this.chunks[i];
        str += this._chunkToString(chunk);
      }
      return str.slice(1);
    }
    /**
     * @method toHex
     * Serializes the script to a hexadecimal string.
     * @returns The script in hexadecimal format.
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      if (this.rawBytesCache == null) {
        this.rawBytesCache = this.serializeChunksToBytes();
      }
      const hex = BufferCtor3 != null ? BufferCtor3.from(this.rawBytesCache).toString("hex") : encode(Array.from(this.rawBytesCache), "hex");
      this.hexCache = hex;
      return hex;
    }
    /**
     * @method toBinary
     * Serializes the script to a binary array.
     * @returns The script in binary array format.
     */
    toBinary() {
      return Array.from(this.toUint8Array());
    }
    toUint8Array() {
      if (this.rawBytesCache == null) {
        this.rawBytesCache = this.serializeChunksToBytes();
      }
      return this.rawBytesCache;
    }
    /**
     * @method writeScript
     * Appends another script to this script.
     * @param script - The script to append.
     * @returns This script instance for chaining.
     */
    writeScript(script) {
      this.invalidateSerializationCaches();
      this.chunks = this.chunks.concat(script.chunks);
      return this;
    }
    /**
     * @method writeOpCode
     * Appends an opcode to the script.
     * @param op - The opcode to append.
     * @returns This script instance for chaining.
     */
    writeOpCode(op) {
      this.invalidateSerializationCaches();
      this.chunks.push({ op });
      return this;
    }
    /**
     * @method setChunkOpCode
     * Sets the opcode of a specific chunk in the script.
     * @param i - The index of the chunk.
     * @param op - The opcode to set.
     * @returns This script instance for chaining.
     */
    setChunkOpCode(i, op) {
      this.invalidateSerializationCaches();
      this.chunks[i] = { op };
      return this;
    }
    /**
     * @method writeBn
     * Appends a BigNumber to the script as an opcode.
     * @param bn - The BigNumber to append.
     * @returns This script instance for chaining.
     */
    writeBn(bn) {
      this.invalidateSerializationCaches();
      if (bn.cmpn(0) === OP_default.OP_0) {
        this.chunks.push({
          op: OP_default.OP_0
        });
      } else if (bn.cmpn(-1) === 0) {
        this.chunks.push({
          op: OP_default.OP_1NEGATE
        });
      } else if (bn.cmpn(1) >= 0 && bn.cmpn(16) <= 0) {
        this.chunks.push({
          op: bn.toNumber() + OP_default.OP_1 - 1
        });
      } else {
        const buf = bn.toSm("little");
        this.writeBin(buf);
      }
      return this;
    }
    /**
     * @method writeBin
     * Appends binary data to the script, determining the appropriate opcode based on length.
     * @param bin - The binary data to append.
     * @returns This script instance for chaining.
     * @throws {Error} Throws an error if the data is too large to be pushed.
     */
    writeBin(bin) {
      this.invalidateSerializationCaches();
      let op;
      const data = bin.length > 0 ? bin : void 0;
      if (bin.length > 0 && bin.length < OP_default.OP_PUSHDATA1) {
        op = bin.length;
      } else if (bin.length === 0) {
        op = OP_default.OP_0;
      } else if (bin.length < Math.pow(2, 8)) {
        op = OP_default.OP_PUSHDATA1;
      } else if (bin.length < Math.pow(2, 16)) {
        op = OP_default.OP_PUSHDATA2;
      } else if (bin.length < Math.pow(2, 32)) {
        op = OP_default.OP_PUSHDATA4;
      } else {
        throw new Error("You can't push that much data");
      }
      this.chunks.push({
        data,
        op
      });
      return this;
    }
    /**
     * @method writeNumber
     * Appends a number to the script.
     * @param num - The number to append.
     * @returns This script instance for chaining.
     */
    writeNumber(num) {
      this.invalidateSerializationCaches();
      this.writeBn(new BigNumber(num));
      return this;
    }
    /**
     * @method removeCodeseparators
     * Removes all OP_CODESEPARATOR opcodes from the script.
     * @returns This script instance for chaining.
     */
    removeCodeseparators() {
      this.invalidateSerializationCaches();
      const chunks = [];
      for (let i = 0; i < this.chunks.length; i++) {
        if (this.chunks[i].op !== OP_default.OP_CODESEPARATOR) {
          chunks.push(this.chunks[i]);
        }
      }
      this.chunks = chunks;
      return this;
    }
    /**
     * Deletes the given item wherever it appears in the current script.
     *
     * @param script - The script containing the item to delete from the current script.
     *
     * @returns This script instance for chaining.
     */
    findAndDelete(script) {
      this.invalidateSerializationCaches();
      const buf = script.toHex();
      for (let i = 0; i < this.chunks.length; i++) {
        const script2 = new _Script([this.chunks[i]]);
        const buf2 = script2.toHex();
        if (buf === buf2) {
          this.chunks.splice(i, 1);
        }
      }
      return this;
    }
    /**
     * @method isPushOnly
     * Checks if the script contains only push data operations.
     * @returns True if the script is push-only, otherwise false.
     */
    isPushOnly() {
      for (let i = 0; i < this.chunks.length; i++) {
        const chunk = this.chunks[i];
        const opCodeNum = chunk.op;
        if (opCodeNum > OP_default.OP_16) {
          return false;
        }
      }
      return true;
    }
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns True if the script is a locking script, otherwise false.
     */
    isLockingScript() {
      throw new Error("Not implemented");
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns True if the script is an unlocking script, otherwise false.
     */
    isUnlockingScript() {
      throw new Error("Not implemented");
    }
    /**
     * @private
     * @method _chunkToString
     * Converts a script chunk to its string representation.
     * @param chunk - The script chunk.
     * @returns The string representation of the chunk.
     */
    static computeSerializedLength(chunks) {
      let total = 0;
      for (const chunk of chunks) {
        total += 1;
        if (chunk.data == null)
          continue;
        const len = chunk.data.length;
        if (chunk.op === OP_default.OP_RETURN) {
          total += len;
          break;
        }
        if (chunk.op < OP_default.OP_PUSHDATA1) {
          total += len;
        } else if (chunk.op === OP_default.OP_PUSHDATA1) {
          total += 1 + len;
        } else if (chunk.op === OP_default.OP_PUSHDATA2) {
          total += 2 + len;
        } else if (chunk.op === OP_default.OP_PUSHDATA4) {
          total += 4 + len;
        }
      }
      return total;
    }
    serializeChunksToBytes() {
      const chunks = this.chunks;
      const totalLength = _Script.computeSerializedLength(chunks);
      const bytes2 = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        bytes2[offset++] = chunk.op;
        if (chunk.data == null)
          continue;
        if (chunk.op === OP_default.OP_RETURN) {
          bytes2.set(chunk.data, offset);
          offset += chunk.data.length;
          break;
        }
        offset = _Script.writeChunkData(bytes2, offset, chunk.op, chunk.data);
      }
      return bytes2;
    }
    invalidateSerializationCaches() {
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    static writeChunkData(target, offset, op, data) {
      const len = data.length;
      if (op < OP_default.OP_PUSHDATA1) {
        target.set(data, offset);
        return offset + len;
      } else if (op === OP_default.OP_PUSHDATA1) {
        target[offset++] = len & 255;
        target.set(data, offset);
        return offset + len;
      } else if (op === OP_default.OP_PUSHDATA2) {
        target[offset++] = len & 255;
        target[offset++] = len >> 8 & 255;
        target.set(data, offset);
        return offset + len;
      } else if (op === OP_default.OP_PUSHDATA4) {
        const size = len >>> 0;
        target[offset++] = size & 255;
        target[offset++] = size >> 8 & 255;
        target[offset++] = size >> 16 & 255;
        target[offset++] = size >> 24 & 255;
        target.set(data, offset);
        return offset + len;
      }
      return offset;
    }
    static parseChunks(bytes2) {
      const chunks = [];
      const length = bytes2.length;
      let pos = 0;
      let inConditionalBlock = 0;
      while (pos < length) {
        const op = bytes2[pos++] ?? 0;
        if (op === OP_default.OP_RETURN && inConditionalBlock === 0) {
          chunks.push({
            op,
            data: _Script.copyRange(bytes2, pos, length)
          });
          break;
        }
        if (op === OP_default.OP_IF || op === OP_default.OP_NOTIF || op === OP_default.OP_VERIF || op === OP_default.OP_VERNOTIF) {
          inConditionalBlock++;
        } else if (op === OP_default.OP_ENDIF) {
          inConditionalBlock--;
        }
        if (op > 0 && op < OP_default.OP_PUSHDATA1) {
          const len = op;
          const end = Math.min(pos + len, length);
          chunks.push({
            data: _Script.copyRange(bytes2, pos, end),
            op
          });
          pos = end;
        } else if (op === OP_default.OP_PUSHDATA1) {
          const len = pos < length ? bytes2[pos++] ?? 0 : 0;
          const end = Math.min(pos + len, length);
          chunks.push({
            data: _Script.copyRange(bytes2, pos, end),
            op
          });
          pos = end;
        } else if (op === OP_default.OP_PUSHDATA2) {
          const b0 = bytes2[pos] ?? 0;
          const b1 = bytes2[pos + 1] ?? 0;
          const len = b0 | b1 << 8;
          pos = Math.min(pos + 2, length);
          const end = Math.min(pos + len, length);
          chunks.push({
            data: _Script.copyRange(bytes2, pos, end),
            op
          });
          pos = end;
        } else if (op === OP_default.OP_PUSHDATA4) {
          const len = ((bytes2[pos] ?? 0) | (bytes2[pos + 1] ?? 0) << 8 | (bytes2[pos + 2] ?? 0) << 16 | (bytes2[pos + 3] ?? 0) << 24) >>> 0;
          pos = Math.min(pos + 4, length);
          const end = Math.min(pos + len, length);
          chunks.push({
            data: _Script.copyRange(bytes2, pos, end),
            op
          });
          pos = end;
        } else {
          chunks.push({ op });
        }
      }
      return chunks;
    }
    static copyRange(bytes2, start, end) {
      const size = Math.max(end - start, 0);
      const data = new Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = bytes2[start + i] ?? 0;
      }
      return data;
    }
    _chunkToString(chunk) {
      const op = chunk.op;
      let str = "";
      if (typeof chunk.data === "undefined") {
        const val = OP_default[op];
        str = `${str} ${val}`;
      } else {
        str = `${str} ${toHex(chunk.data)}`;
      }
      return str;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/LockingScript.js
  var LockingScript = class extends Script {
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns {boolean} Always returns true for a LockingScript instance.
     */
    isLockingScript() {
      return true;
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns {boolean} Always returns false for a LockingScript instance.
     */
    isUnlockingScript() {
      return false;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/UnlockingScript.js
  var UnlockingScript = class extends Script {
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns {boolean} Always returns false for an UnlockingScript instance.
     */
    isLockingScript() {
      return false;
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns {boolean} Always returns true for an UnlockingScript instance.
     */
    isUnlockingScript() {
      return true;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/ScriptEvaluationError.js
  var ScriptEvaluationError = class extends Error {
    constructor(params) {
      const stackHex = params.stackState.map((s2) => s2 != null && typeof s2.length !== "undefined" ? toHex(s2) : s2 === null || s2 === void 0 ? "null/undef" : "INVALID_STACK_ITEM").join(", ");
      const altStackHex = params.altStackState.map((s2) => s2 != null && typeof s2.length !== "undefined" ? toHex(s2) : s2 === null || s2 === void 0 ? "null/undef" : "INVALID_STACK_ITEM").join(", ");
      const pcInfo = `Context: ${params.context}, PC: ${params.programCounter}`;
      const stackInfo = `Stack: [${stackHex}] (len: ${params.stackState.length}, mem: ${params.stackMem})`;
      const altStackInfo = `AltStack: [${altStackHex}] (len: ${params.altStackState.length}, mem: ${params.altStackMem})`;
      const ifStackInfo = `IfStack: [${params.ifStackState.join(", ")}]`;
      const fullMessage = `Script evaluation error: ${params.message}
TXID: ${params.txid}, OutputIdx: ${params.outputIndex}
${pcInfo}
${stackInfo}
${altStackInfo}
${ifStackInfo}`;
      super(fullMessage);
      __publicField(this, "txid");
      __publicField(this, "outputIndex");
      __publicField(this, "context");
      __publicField(this, "programCounter");
      __publicField(this, "stackState");
      __publicField(this, "altStackState");
      __publicField(this, "ifStackState");
      __publicField(this, "stackMem");
      __publicField(this, "altStackMem");
      this.name = this.constructor.name;
      this.txid = params.txid;
      this.outputIndex = params.outputIndex;
      this.context = params.context;
      this.programCounter = params.programCounter;
      this.stackState = params.stackState.map((s2) => s2.slice());
      this.altStackState = params.altStackState.map((s2) => s2.slice());
      this.ifStackState = params.ifStackState.slice();
      this.stackMem = params.stackMem;
      this.altStackMem = params.altStackMem;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/Spend.js
  var maxScriptElementSize = 1024 * 1024 * 1024;
  var maxMultisigKeyCount = Math.pow(2, 31) - 1;
  var maxMultisigKeyCountBigInt = BigInt(maxMultisigKeyCount);
  var requireMinimalPush = true;
  var requirePushOnlyUnlockingScripts = true;
  var requireLowSSignatures = true;
  var requireCleanStack = true;
  var SCRIPTNUM_NEG_1 = Object.freeze(new BigNumber(-1).toScriptNum());
  var SCRIPTNUMS_0_TO_16 = Object.freeze(Array.from({ length: 17 }, (_, i) => Object.freeze(new BigNumber(i).toScriptNum())));
  function compareNumberArrays(a, b) {
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i])
        return false;
    }
    return true;
  }
  function isMinimallyEncodedHelper(buf, maxNumSize = Number.MAX_SAFE_INTEGER) {
    if (buf.length > maxNumSize) {
      return false;
    }
    if (buf.length > 0) {
      if ((buf[buf.length - 1] & 127) === 0) {
        if (buf.length <= 1 || (buf[buf.length - 2] & 128) === 0) {
          return false;
        }
      }
    }
    return true;
  }
  function isChecksigFormatHelper(buf) {
    if (buf.length < 9 || buf.length > 73)
      return false;
    if (buf[0] !== 48)
      return false;
    if (buf[1] !== buf.length - 3)
      return false;
    const rMarker = buf[2];
    const rLen = buf[3];
    if (rMarker !== 2)
      return false;
    if (rLen === 0)
      return false;
    if (5 + rLen >= buf.length)
      return false;
    const sMarkerOffset = 4 + rLen;
    const sMarker = buf[sMarkerOffset];
    const sLen = buf[sMarkerOffset + 1];
    if (sMarker !== 2)
      return false;
    if (sLen === 0)
      return false;
    if ((buf[4] & 128) !== 0)
      return false;
    if (rLen > 1 && buf[4] === 0 && (buf[5] & 128) === 0)
      return false;
    const sValueOffset = sMarkerOffset + 2;
    if ((buf[sValueOffset] & 128) !== 0)
      return false;
    if (sLen > 1 && buf[sValueOffset] === 0 && (buf[sValueOffset + 1] & 128) === 0)
      return false;
    if (rLen + sLen + 7 !== buf.length)
      return false;
    return true;
  }
  function isOpcodeDisabledHelper(op) {
    return op === OP_default.OP_2MUL || op === OP_default.OP_2DIV || op === OP_default.OP_VERIF || op === OP_default.OP_VERNOTIF || op === OP_default.OP_VER;
  }
  function isChunkMinimalPushHelper(chunk) {
    const data = chunk.data;
    const op = chunk.op;
    if (!Array.isArray(data))
      return true;
    if (data.length === 0)
      return op === OP_default.OP_0;
    if (data.length === 1 && data[0] >= 1 && data[0] <= 16)
      return op === OP_default.OP_1 + (data[0] - 1);
    if (data.length === 1 && data[0] === 129)
      return op === OP_default.OP_1NEGATE;
    if (data.length <= 75)
      return op === data.length;
    if (data.length <= 255)
      return op === OP_default.OP_PUSHDATA1;
    if (data.length <= 65535)
      return op === OP_default.OP_PUSHDATA2;
    return true;
  }
  var Spend = class {
    /**
     * @constructor
     * Constructs the Spend object with necessary transaction details.
     * @param {string} params.sourceTXID - The transaction ID of the source UTXO.
     * @param {number} params.sourceOutputIndex - The index of the output in the source transaction.
     * @param {BigNumber} params.sourceSatoshis - The amount of satoshis in the source UTXO.
     * @param {LockingScript} params.lockingScript - The locking script associated with the UTXO.
     * @param {number} params.transactionVersion - The version of the current transaction.
     * @param {Array<{ sourceTXID: string, sourceOutputIndex: number, sequence: number }>} params.otherInputs -
     *        An array of other inputs in the transaction.
     * @param {Array<{ satoshis: BigNumber, lockingScript: LockingScript }>} params.outputs -
     *        The outputs of the current transaction.
     * @param {number} params.inputIndex - The index of this input in the current transaction.
     * @param {UnlockingScript} params.unlockingScript - The unlocking script for this spend.
     * @param {number} params.inputSequence - The sequence number of this input.
     * @param {number} params.lockTime - The lock time of the transaction.
     *
     * @example
     * const spend = new Spend({
     *   sourceTXID: "abcd1234", // sourceTXID
     *   sourceOutputIndex: 0, // sourceOutputIndex
     *   sourceSatoshis: new BigNumber(1000), // sourceSatoshis
     *   lockingScript: LockingScript.fromASM("OP_DUP OP_HASH160 abcd1234... OP_EQUALVERIFY OP_CHECKSIG"),
     *   transactionVersion: 1, // transactionVersion
     *   otherInputs: [{ sourceTXID: "abcd1234", sourceOutputIndex: 1, sequence: 0xffffffff }], // otherInputs
     *   outputs: [{ satoshis: new BigNumber(500), lockingScript: LockingScript.fromASM("OP_DUP...") }], // outputs
     *   inputIndex: 0, // inputIndex
     *   unlockingScript: UnlockingScript.fromASM("3045... 02ab..."),
     *   inputSequence: 0xffffffff // inputSequence
     *   memoryLimit: 100000 // memoryLimit
     * });
     */
    constructor(params) {
      __publicField(this, "sourceTXID");
      __publicField(this, "sourceOutputIndex");
      __publicField(this, "sourceSatoshis");
      __publicField(this, "lockingScript");
      __publicField(this, "transactionVersion");
      __publicField(this, "otherInputs");
      __publicField(this, "outputs");
      __publicField(this, "inputIndex");
      __publicField(this, "unlockingScript");
      __publicField(this, "inputSequence");
      __publicField(this, "lockTime");
      __publicField(this, "context");
      __publicField(this, "programCounter");
      __publicField(this, "lastCodeSeparator");
      __publicField(this, "stack");
      __publicField(this, "altStack");
      __publicField(this, "ifStack");
      __publicField(this, "memoryLimit");
      __publicField(this, "stackMem");
      __publicField(this, "altStackMem");
      __publicField(this, "sigHashCache");
      this.sourceTXID = params.sourceTXID;
      this.sourceOutputIndex = params.sourceOutputIndex;
      this.sourceSatoshis = params.sourceSatoshis;
      this.lockingScript = params.lockingScript;
      this.transactionVersion = params.transactionVersion;
      this.otherInputs = params.otherInputs;
      this.outputs = params.outputs;
      this.inputIndex = params.inputIndex;
      this.unlockingScript = params.unlockingScript;
      this.inputSequence = params.inputSequence;
      this.lockTime = params.lockTime;
      this.memoryLimit = params.memoryLimit ?? 32e6;
      this.stack = [];
      this.altStack = [];
      this.ifStack = [];
      this.stackMem = 0;
      this.altStackMem = 0;
      this.sigHashCache = { hashOutputsSingle: /* @__PURE__ */ new Map() };
      this.reset();
    }
    reset() {
      this.context = "UnlockingScript";
      this.programCounter = 0;
      this.lastCodeSeparator = null;
      this.stack = [];
      this.altStack = [];
      this.ifStack = [];
      this.stackMem = 0;
      this.altStackMem = 0;
      this.sigHashCache = { hashOutputsSingle: /* @__PURE__ */ new Map() };
    }
    ensureStackMem(additional) {
      if (this.stackMem + additional > this.memoryLimit) {
        this.scriptEvaluationError("Stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
      }
    }
    ensureAltStackMem(additional) {
      if (this.altStackMem + additional > this.memoryLimit) {
        this.scriptEvaluationError("Alt stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
      }
    }
    pushStack(item) {
      this.ensureStackMem(item.length);
      this.stack.push(item);
      this.stackMem += item.length;
    }
    pushStackCopy(item) {
      this.ensureStackMem(item.length);
      const copy = item.slice();
      this.stack.push(copy);
      this.stackMem += copy.length;
    }
    popStack() {
      if (this.stack.length === 0) {
        this.scriptEvaluationError("Attempted to pop from an empty stack.");
      }
      const item = this.stack.pop();
      this.stackMem -= item.length;
      return item;
    }
    stackTop(index = -1) {
      if (this.stack.length === 0 || this.stack.length < Math.abs(index) || index >= 0 && index >= this.stack.length) {
        this.scriptEvaluationError(`Stack underflow accessing element at index ${index}. Stack length is ${this.stack.length}.`);
      }
      return this.stack[this.stack.length + index];
    }
    pushAltStack(item) {
      this.ensureAltStackMem(item.length);
      this.altStack.push(item);
      this.altStackMem += item.length;
    }
    popAltStack() {
      if (this.altStack.length === 0) {
        this.scriptEvaluationError("Attempted to pop from an empty alt stack.");
      }
      const item = this.altStack.pop();
      this.altStackMem -= item.length;
      return item;
    }
    checkSignatureEncoding(buf) {
      if (buf.length === 0)
        return true;
      if (!isChecksigFormatHelper(buf)) {
        this.scriptEvaluationError("The signature format is invalid.");
        return false;
      }
      try {
        const sig = TransactionSignature.fromChecksigFormat(buf);
        if (requireLowSSignatures && !sig.hasLowS()) {
          this.scriptEvaluationError("The signature must have a low S value.");
          return false;
        }
        if ((sig.scope & TransactionSignature.SIGHASH_FORKID) === 0) {
          this.scriptEvaluationError("The signature must use SIGHASH_FORKID.");
          return false;
        }
      } catch (e) {
        this.scriptEvaluationError("The signature format is invalid.");
        return false;
      }
      return true;
    }
    checkPublicKeyEncoding(buf) {
      if (buf.length === 0) {
        this.scriptEvaluationError("Public key is empty.");
        return false;
      }
      if (buf.length < 33) {
        this.scriptEvaluationError("The public key is too short, it must be at least 33 bytes.");
        return false;
      }
      if (buf[0] === 4) {
        if (buf.length !== 65) {
          this.scriptEvaluationError("The non-compressed public key must be 65 bytes.");
          return false;
        }
      } else if (buf[0] === 2 || buf[0] === 3) {
        if (buf.length !== 33) {
          this.scriptEvaluationError("The compressed public key must be 33 bytes.");
          return false;
        }
      } else {
        this.scriptEvaluationError("The public key is in an unknown format.");
        return false;
      }
      try {
        PublicKey.fromDER(buf);
      } catch (e) {
        this.scriptEvaluationError("The public key is in an unknown format.");
        return false;
      }
      return true;
    }
    verifySignature(sig, pubkey, subscript) {
      const preimage = TransactionSignature.formatBytes({
        sourceTXID: this.sourceTXID,
        sourceOutputIndex: this.sourceOutputIndex,
        sourceSatoshis: this.sourceSatoshis,
        transactionVersion: this.transactionVersion,
        otherInputs: this.otherInputs,
        outputs: this.outputs,
        inputIndex: this.inputIndex,
        subscript,
        inputSequence: this.inputSequence,
        lockTime: this.lockTime,
        scope: sig.scope,
        cache: this.sigHashCache
      });
      const hash = new BigNumber(hash256(preimage));
      return verify(hash, sig, pubkey);
    }
    step() {
      if (this.stackMem > this.memoryLimit) {
        this.scriptEvaluationError("Stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
        return false;
      }
      if (this.altStackMem > this.memoryLimit) {
        this.scriptEvaluationError("Alt stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
        return false;
      }
      if (this.context === "UnlockingScript" && this.programCounter >= this.unlockingScript.chunks.length) {
        this.context = "LockingScript";
        this.programCounter = 0;
      }
      const currentScript = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
      if (this.programCounter >= currentScript.chunks.length) {
        return false;
      }
      const operation = currentScript.chunks[this.programCounter];
      const currentOpcode = operation.op;
      if (typeof currentOpcode === "undefined") {
        this.scriptEvaluationError(`Missing opcode in ${this.context} at pc=${this.programCounter}.`);
      }
      if (Array.isArray(operation.data) && operation.data.length > maxScriptElementSize) {
        this.scriptEvaluationError(`Data push > ${maxScriptElementSize} bytes (pc=${this.programCounter}).`);
      }
      const isScriptExecuting = !this.ifStack.includes(false);
      if (isScriptExecuting && isOpcodeDisabledHelper(currentOpcode)) {
        this.scriptEvaluationError(`This opcode is currently disabled. (Opcode: ${OP_default[currentOpcode]}, PC: ${this.programCounter})`);
      }
      if (isScriptExecuting && currentOpcode >= 0 && currentOpcode <= OP_default.OP_PUSHDATA4) {
        if (requireMinimalPush && !isChunkMinimalPushHelper(operation)) {
          this.scriptEvaluationError(`This data is not minimally-encoded. (PC: ${this.programCounter})`);
        }
        this.pushStack(Array.isArray(operation.data) ? operation.data : []);
      } else if (isScriptExecuting || currentOpcode >= OP_default.OP_IF && currentOpcode <= OP_default.OP_ENDIF) {
        let buf, buf1, buf2, buf3;
        let x1, x2, x3;
        let bn, bn1, bn2, bn3;
        let n, size, fValue, fSuccess, subscript;
        let bufSig, bufPubkey;
        let sig, pubkey;
        let i, ikey, isig, nKeysCount, nSigsCount, fOk;
        switch (currentOpcode) {
          case OP_default.OP_1NEGATE:
            this.pushStackCopy(SCRIPTNUM_NEG_1);
            break;
          case OP_default.OP_0:
            this.pushStackCopy(SCRIPTNUMS_0_TO_16[0]);
            break;
          case OP_default.OP_1:
          case OP_default.OP_2:
          case OP_default.OP_3:
          case OP_default.OP_4:
          case OP_default.OP_5:
          case OP_default.OP_6:
          case OP_default.OP_7:
          case OP_default.OP_8:
          case OP_default.OP_9:
          case OP_default.OP_10:
          case OP_default.OP_11:
          case OP_default.OP_12:
          case OP_default.OP_13:
          case OP_default.OP_14:
          case OP_default.OP_15:
          case OP_default.OP_16:
            n = currentOpcode - (OP_default.OP_1 - 1);
            this.pushStackCopy(SCRIPTNUMS_0_TO_16[n]);
            break;
          case OP_default.OP_NOP:
          case OP_default.OP_NOP2:
          // Formerly CHECKLOCKTIMEVERIFY
          case OP_default.OP_NOP3:
          // Formerly CHECKSEQUENCEVERIFY
          case OP_default.OP_NOP1:
          case OP_default.OP_NOP4:
          case OP_default.OP_NOP5:
          case OP_default.OP_NOP6:
          case OP_default.OP_NOP7:
          case OP_default.OP_NOP8:
          case OP_default.OP_NOP9:
          case OP_default.OP_NOP10:
          /* falls through */
          // eslint-disable-next-line no-fallthrough
          // eslint-disable-next-line no-fallthrough
          case OP_default.OP_NOP11:
          case OP_default.OP_NOP12:
          case OP_default.OP_NOP13:
          case OP_default.OP_NOP14:
          case OP_default.OP_NOP15:
          case OP_default.OP_NOP16:
          case OP_default.OP_NOP17:
          case OP_default.OP_NOP18:
          case OP_default.OP_NOP19:
          case OP_default.OP_NOP20:
          case OP_default.OP_NOP21:
          case OP_default.OP_NOP22:
          case OP_default.OP_NOP23:
          case OP_default.OP_NOP24:
          case OP_default.OP_NOP25:
          case OP_default.OP_NOP26:
          case OP_default.OP_NOP27:
          case OP_default.OP_NOP28:
          case OP_default.OP_NOP29:
          case OP_default.OP_NOP30:
          case OP_default.OP_NOP31:
          case OP_default.OP_NOP32:
          case OP_default.OP_NOP33:
          case OP_default.OP_NOP34:
          case OP_default.OP_NOP35:
          case OP_default.OP_NOP36:
          case OP_default.OP_NOP37:
          case OP_default.OP_NOP38:
          case OP_default.OP_NOP39:
          case OP_default.OP_NOP40:
          case OP_default.OP_NOP41:
          case OP_default.OP_NOP42:
          case OP_default.OP_NOP43:
          case OP_default.OP_NOP44:
          case OP_default.OP_NOP45:
          case OP_default.OP_NOP46:
          case OP_default.OP_NOP47:
          case OP_default.OP_NOP48:
          case OP_default.OP_NOP49:
          case OP_default.OP_NOP50:
          case OP_default.OP_NOP51:
          case OP_default.OP_NOP52:
          case OP_default.OP_NOP53:
          case OP_default.OP_NOP54:
          case OP_default.OP_NOP55:
          case OP_default.OP_NOP56:
          case OP_default.OP_NOP57:
          case OP_default.OP_NOP58:
          case OP_default.OP_NOP59:
          case OP_default.OP_NOP60:
          case OP_default.OP_NOP61:
          case OP_default.OP_NOP62:
          case OP_default.OP_NOP63:
          case OP_default.OP_NOP64:
          case OP_default.OP_NOP65:
          case OP_default.OP_NOP66:
          case OP_default.OP_NOP67:
          case OP_default.OP_NOP68:
          case OP_default.OP_NOP69:
          case OP_default.OP_NOP70:
          case OP_default.OP_NOP71:
          case OP_default.OP_NOP72:
          case OP_default.OP_NOP73:
          case OP_default.OP_NOP77:
            break;
          case OP_default.OP_IF:
          case OP_default.OP_NOTIF:
            fValue = false;
            if (isScriptExecuting) {
              if (this.stack.length < 1)
                this.scriptEvaluationError("OP_IF and OP_NOTIF require at least one item on the stack when they are used!");
              buf = this.popStack();
              fValue = this.castToBool(buf);
              if (currentOpcode === OP_default.OP_NOTIF)
                fValue = !fValue;
            }
            this.ifStack.push(fValue);
            break;
          case OP_default.OP_ELSE:
            if (this.ifStack.length === 0)
              this.scriptEvaluationError("OP_ELSE requires a preceeding OP_IF.");
            this.ifStack[this.ifStack.length - 1] = !this.ifStack[this.ifStack.length - 1];
            break;
          case OP_default.OP_ENDIF:
            if (this.ifStack.length === 0)
              this.scriptEvaluationError("OP_ENDIF requires a preceeding OP_IF.");
            this.ifStack.pop();
            break;
          case OP_default.OP_VERIFY:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_VERIFY requires at least one item to be on the stack.");
            buf1 = this.stackTop();
            fValue = this.castToBool(buf1);
            if (!fValue)
              this.scriptEvaluationError("OP_VERIFY requires the top stack value to be truthy.");
            this.popStack();
            break;
          case OP_default.OP_RETURN:
            if (this.context === "UnlockingScript")
              this.programCounter = this.unlockingScript.chunks.length;
            else
              this.programCounter = this.lockingScript.chunks.length;
            this.ifStack = [];
            this.programCounter--;
            break;
          case OP_default.OP_TOALTSTACK:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_TOALTSTACK requires at oeast one item to be on the stack.");
            this.pushAltStack(this.popStack());
            break;
          case OP_default.OP_FROMALTSTACK:
            if (this.altStack.length < 1)
              this.scriptEvaluationError("OP_FROMALTSTACK requires at least one item to be on the stack.");
            this.pushStack(this.popAltStack());
            break;
          case OP_default.OP_2DROP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_2DROP requires at least two items to be on the stack.");
            this.popStack();
            this.popStack();
            break;
          case OP_default.OP_2DUP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_2DUP requires at least two items to be on the stack.");
            buf1 = this.stackTop(-2);
            buf2 = this.stackTop(-1);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            break;
          case OP_default.OP_3DUP:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_3DUP requires at least three items to be on the stack.");
            buf1 = this.stackTop(-3);
            buf2 = this.stackTop(-2);
            buf3 = this.stackTop(-1);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            this.pushStackCopy(buf3);
            break;
          case OP_default.OP_2OVER:
            if (this.stack.length < 4)
              this.scriptEvaluationError("OP_2OVER requires at least four items to be on the stack.");
            buf1 = this.stackTop(-4);
            buf2 = this.stackTop(-3);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            break;
          case OP_default.OP_2ROT: {
            if (this.stack.length < 6)
              this.scriptEvaluationError("OP_2ROT requires at least six items to be on the stack.");
            const rot6 = this.popStack();
            const rot5 = this.popStack();
            const rot4 = this.popStack();
            const rot3 = this.popStack();
            const rot2 = this.popStack();
            const rot1 = this.popStack();
            this.pushStack(rot3);
            this.pushStack(rot4);
            this.pushStack(rot5);
            this.pushStack(rot6);
            this.pushStack(rot1);
            this.pushStack(rot2);
            break;
          }
          case OP_default.OP_2SWAP: {
            if (this.stack.length < 4)
              this.scriptEvaluationError("OP_2SWAP requires at least four items to be on the stack.");
            const swap4 = this.popStack();
            const swap3 = this.popStack();
            const swap2 = this.popStack();
            const swap1 = this.popStack();
            this.pushStack(swap3);
            this.pushStack(swap4);
            this.pushStack(swap1);
            this.pushStack(swap2);
            break;
          }
          case OP_default.OP_IFDUP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_IFDUP requires at least one item to be on the stack.");
            buf1 = this.stackTop();
            if (this.castToBool(buf1)) {
              this.pushStackCopy(buf1);
            }
            break;
          case OP_default.OP_DEPTH:
            this.pushStack(new BigNumber(this.stack.length).toScriptNum());
            break;
          case OP_default.OP_DROP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_DROP requires at least one item to be on the stack.");
            this.popStack();
            break;
          case OP_default.OP_DUP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_DUP requires at least one item to be on the stack.");
            this.pushStackCopy(this.stackTop());
            break;
          case OP_default.OP_NIP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_NIP requires at least two items to be on the stack.");
            buf2 = this.popStack();
            this.popStack();
            this.pushStack(buf2);
            break;
          case OP_default.OP_OVER:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_OVER requires at least two items to be on the stack.");
            this.pushStackCopy(this.stackTop(-2));
            break;
          case OP_default.OP_PICK:
          case OP_default.OP_ROLL: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bn = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            const nBigInt = bn.toBigInt();
            if (nBigInt < 0n || nBigInt >= BigInt(this.stack.length)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top stack element to be 0 or a positive number less than the current size of the stack.`);
            }
            const nIndex = Number(nBigInt);
            const itemToMoveOrCopy = this.stack[this.stack.length - 1 - nIndex];
            if (currentOpcode === OP_default.OP_ROLL) {
              this.stack.splice(this.stack.length - 1 - nIndex, 1);
              this.stackMem -= itemToMoveOrCopy.length;
              this.pushStack(itemToMoveOrCopy);
            } else {
              this.pushStackCopy(itemToMoveOrCopy);
            }
            break;
          }
          case OP_default.OP_ROT:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_ROT requires at least three items to be on the stack.");
            x3 = this.popStack();
            x2 = this.popStack();
            x1 = this.popStack();
            this.pushStack(x2);
            this.pushStack(x3);
            this.pushStack(x1);
            break;
          case OP_default.OP_SWAP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_SWAP requires at least two items to be on the stack.");
            x2 = this.popStack();
            x1 = this.popStack();
            this.pushStack(x2);
            this.pushStack(x1);
            break;
          case OP_default.OP_TUCK:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_TUCK requires at least two items to be on the stack.");
            buf1 = this.stackTop(-1);
            this.ensureStackMem(buf1.length);
            this.stack.splice(this.stack.length - 2, 0, buf1.slice());
            this.stackMem += buf1.length;
            break;
          case OP_default.OP_SIZE:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_SIZE requires at least one item to be on the stack.");
            this.pushStack(new BigNumber(this.stackTop().length).toScriptNum());
            break;
          case OP_default.OP_AND:
          case OP_default.OP_OR:
          case OP_default.OP_XOR: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            if (buf1.length !== buf2.length)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top two stack items to be the same size.`);
            const resultBufBitwiseOp = new Array(buf1.length);
            for (let k = 0; k < buf1.length; k++) {
              if (currentOpcode === OP_default.OP_AND)
                resultBufBitwiseOp[k] = buf1[k] & buf2[k];
              else if (currentOpcode === OP_default.OP_OR)
                resultBufBitwiseOp[k] = buf1[k] | buf2[k];
              else
                resultBufBitwiseOp[k] = buf1[k] ^ buf2[k];
            }
            this.pushStack(resultBufBitwiseOp);
            break;
          }
          case OP_default.OP_INVERT: {
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_INVERT requires at least one item to be on the stack.");
            buf = this.popStack();
            const invertedBufOp = new Array(buf.length);
            for (let k = 0; k < buf.length; k++) {
              invertedBufOp[k] = ~buf[k] & 255;
            }
            this.pushStack(invertedBufOp);
            break;
          }
          case OP_default.OP_LSHIFT:
          case OP_default.OP_RSHIFT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bn2 = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            buf1 = this.popStack();
            const shiftBits = bn2.toBigInt();
            if (shiftBits < 0n)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top item on the stack not to be negative.`);
            if (buf1.length === 0) {
              this.pushStack([]);
              break;
            }
            bn1 = new BigNumber(buf1);
            let shiftedBn;
            if (currentOpcode === OP_default.OP_LSHIFT)
              shiftedBn = bn1.ushln(shiftBits);
            else
              shiftedBn = bn1.ushrn(shiftBits);
            const shiftedArr = shiftedBn.toArray("be", buf1.length);
            this.pushStack(shiftedArr);
            break;
          }
          case OP_default.OP_EQUAL:
          case OP_default.OP_EQUALVERIFY:
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            fValue = compareNumberArrays(buf1, buf2);
            this.pushStack(fValue ? [1] : []);
            if (currentOpcode === OP_default.OP_EQUALVERIFY) {
              if (!fValue)
                this.scriptEvaluationError("OP_EQUALVERIFY requires the top two stack items to be equal.");
              this.popStack();
            }
            break;
          case OP_default.OP_1ADD:
          case OP_default.OP_1SUB:
          case OP_default.OP_NEGATE:
          case OP_default.OP_ABS:
          case OP_default.OP_NOT:
          case OP_default.OP_0NOTEQUAL:
            if (this.stack.length < 1)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least one item to be on the stack.`);
            bn = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            switch (currentOpcode) {
              case OP_default.OP_1ADD:
                bn = bn.add(new BigNumber(1));
                break;
              case OP_default.OP_1SUB:
                bn = bn.sub(new BigNumber(1));
                break;
              case OP_default.OP_NEGATE:
                bn = bn.neg();
                break;
              case OP_default.OP_ABS:
                if (bn.isNeg())
                  bn = bn.neg();
                break;
              case OP_default.OP_NOT:
                bn = new BigNumber(bn.cmpn(0) === 0 ? 1 : 0);
                break;
              case OP_default.OP_0NOTEQUAL:
                bn = new BigNumber(bn.cmpn(0) !== 0 ? 1 : 0);
                break;
            }
            this.pushStack(bn.toScriptNum());
            break;
          case OP_default.OP_ADD:
          case OP_default.OP_SUB:
          case OP_default.OP_MUL:
          case OP_default.OP_DIV:
          case OP_default.OP_MOD:
          case OP_default.OP_BOOLAND:
          case OP_default.OP_BOOLOR:
          case OP_default.OP_NUMEQUAL:
          case OP_default.OP_NUMEQUALVERIFY:
          case OP_default.OP_NUMNOTEQUAL:
          case OP_default.OP_LESSTHAN:
          case OP_default.OP_GREATERTHAN:
          case OP_default.OP_LESSTHANOREQUAL:
          case OP_default.OP_GREATERTHANOREQUAL:
          case OP_default.OP_MIN:
          case OP_default.OP_MAX: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            bn2 = BigNumber.fromScriptNum(buf2, requireMinimalPush);
            bn1 = BigNumber.fromScriptNum(buf1, requireMinimalPush);
            let predictedLen = 0;
            switch (currentOpcode) {
              case OP_default.OP_MUL:
                predictedLen = bn1.byteLength() + bn2.byteLength();
                break;
              case OP_default.OP_ADD:
              case OP_default.OP_SUB:
                predictedLen = Math.max(bn1.byteLength(), bn2.byteLength()) + 1;
                break;
              default:
                predictedLen = Math.max(bn1.byteLength(), bn2.byteLength());
            }
            this.ensureStackMem(predictedLen);
            let resultBnArithmetic = new BigNumber(0);
            switch (currentOpcode) {
              case OP_default.OP_ADD:
                resultBnArithmetic = bn1.add(bn2);
                break;
              case OP_default.OP_SUB:
                resultBnArithmetic = bn1.sub(bn2);
                break;
              case OP_default.OP_MUL:
                resultBnArithmetic = bn1.mul(bn2);
                break;
              case OP_default.OP_DIV:
                if (bn2.cmpn(0) === 0)
                  this.scriptEvaluationError("OP_DIV cannot divide by zero!");
                resultBnArithmetic = bn1.div(bn2);
                break;
              case OP_default.OP_MOD:
                if (bn2.cmpn(0) === 0)
                  this.scriptEvaluationError("OP_MOD cannot divide by zero!");
                resultBnArithmetic = bn1.mod(bn2);
                break;
              case OP_default.OP_BOOLAND:
                resultBnArithmetic = new BigNumber(bn1.cmpn(0) !== 0 && bn2.cmpn(0) !== 0 ? 1 : 0);
                break;
              case OP_default.OP_BOOLOR:
                resultBnArithmetic = new BigNumber(bn1.cmpn(0) !== 0 || bn2.cmpn(0) !== 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMEQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) === 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMEQUALVERIFY:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) === 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMNOTEQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) !== 0 ? 1 : 0);
                break;
              case OP_default.OP_LESSTHAN:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) < 0 ? 1 : 0);
                break;
              case OP_default.OP_GREATERTHAN:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) > 0 ? 1 : 0);
                break;
              case OP_default.OP_LESSTHANOREQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) <= 0 ? 1 : 0);
                break;
              case OP_default.OP_GREATERTHANOREQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) >= 0 ? 1 : 0);
                break;
              case OP_default.OP_MIN:
                resultBnArithmetic = bn1.cmp(bn2) < 0 ? bn1 : bn2;
                break;
              case OP_default.OP_MAX:
                resultBnArithmetic = bn1.cmp(bn2) > 0 ? bn1 : bn2;
                break;
            }
            this.pushStack(resultBnArithmetic.toScriptNum());
            if (currentOpcode === OP_default.OP_NUMEQUALVERIFY) {
              if (!this.castToBool(this.stackTop()))
                this.scriptEvaluationError("OP_NUMEQUALVERIFY requires the top stack item to be truthy.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_WITHIN:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_WITHIN requires at least three items to be on the stack.");
            bn3 = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            bn2 = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            bn1 = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush);
            fValue = bn1.cmp(bn2) >= 0 && bn1.cmp(bn3) < 0;
            this.pushStack(fValue ? [1] : []);
            break;
          case OP_default.OP_RIPEMD160:
          case OP_default.OP_SHA1:
          case OP_default.OP_SHA256:
          case OP_default.OP_HASH160:
          case OP_default.OP_HASH256: {
            if (this.stack.length < 1)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least one item to be on the stack.`);
            buf = this.popStack();
            let hashResult = [];
            if (currentOpcode === OP_default.OP_RIPEMD160)
              hashResult = ripemd160(buf);
            else if (currentOpcode === OP_default.OP_SHA1)
              hashResult = sha1(buf);
            else if (currentOpcode === OP_default.OP_SHA256)
              hashResult = sha256(buf);
            else if (currentOpcode === OP_default.OP_HASH160)
              hashResult = hash160(buf);
            else if (currentOpcode === OP_default.OP_HASH256)
              hashResult = hash256(buf);
            this.pushStack(hashResult);
            break;
          }
          case OP_default.OP_CODESEPARATOR:
            this.lastCodeSeparator = this.programCounter;
            break;
          case OP_default.OP_CHECKSIG:
          case OP_default.OP_CHECKSIGVERIFY: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bufPubkey = this.popStack();
            bufSig = this.popStack();
            if (!this.checkSignatureEncoding(bufSig) || !this.checkPublicKeyEncoding(bufPubkey)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires correct encoding for the public key and signature.`);
            }
            const scriptForChecksig = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
            const scriptCodeChunks = scriptForChecksig.chunks.slice(this.lastCodeSeparator === null ? 0 : this.lastCodeSeparator + 1);
            subscript = new Script(scriptCodeChunks);
            subscript.findAndDelete(new Script().writeBin(bufSig));
            fSuccess = false;
            if (bufSig.length > 0) {
              try {
                sig = TransactionSignature.fromChecksigFormat(bufSig);
                pubkey = PublicKey.fromDER(bufPubkey);
                fSuccess = this.verifySignature(sig, pubkey, subscript);
              } catch (e) {
                fSuccess = false;
              }
            }
            this.pushStack(fSuccess ? [1] : []);
            if (currentOpcode === OP_default.OP_CHECKSIGVERIFY) {
              if (!fSuccess)
                this.scriptEvaluationError("OP_CHECKSIGVERIFY requires that a valid signature is provided.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_CHECKMULTISIG:
          case OP_default.OP_CHECKMULTISIGVERIFY: {
            i = 1;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least 1 item for nKeys.`);
            }
            const nKeysCountBN = BigNumber.fromScriptNum(this.stackTop(-i), requireMinimalPush);
            const nKeysCountBigInt = nKeysCountBN.toBigInt();
            if (nKeysCountBigInt < 0n || nKeysCountBigInt > maxMultisigKeyCountBigInt) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires a key count between 0 and ${maxMultisigKeyCount}.`);
            }
            nKeysCount = Number(nKeysCountBigInt);
            const declaredKeyCount = nKeysCount;
            ikey = ++i;
            i += nKeysCount;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} stack too small for nKeys and keys. Need ${i}, have ${this.stack.length}.`);
            }
            const nSigsCountBN = BigNumber.fromScriptNum(this.stackTop(-i), requireMinimalPush);
            const nSigsCountBigInt = nSigsCountBN.toBigInt();
            if (nSigsCountBigInt < 0n || nSigsCountBigInt > BigInt(nKeysCount)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the number of signatures to be no greater than the number of keys.`);
            }
            nSigsCount = Number(nSigsCountBigInt);
            const declaredSigCount = nSigsCount;
            isig = ++i;
            i += nSigsCount;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} stack too small for N, keys, M, sigs, and dummy. Need ${i}, have ${this.stack.length}.`);
            }
            const baseScriptCMS = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
            const subscriptChunksCMS = baseScriptCMS.chunks.slice(this.lastCodeSeparator === null ? 0 : this.lastCodeSeparator + 1);
            subscript = new Script(subscriptChunksCMS);
            for (let k = 0; k < nSigsCount; k++) {
              bufSig = this.stackTop(-isig - k);
              subscript.findAndDelete(new Script().writeBin(bufSig));
            }
            fSuccess = true;
            while (fSuccess && nSigsCount > 0) {
              if (nKeysCount === 0) {
                fSuccess = false;
                break;
              }
              bufSig = this.stackTop(-isig);
              bufPubkey = this.stackTop(-ikey);
              if (!this.checkSignatureEncoding(bufSig) || !this.checkPublicKeyEncoding(bufPubkey)) {
                this.scriptEvaluationError(`${OP_default[currentOpcode]} requires correct encoding for the public key and signature.`);
              }
              fOk = false;
              if (bufSig.length > 0) {
                try {
                  sig = TransactionSignature.fromChecksigFormat(bufSig);
                  pubkey = PublicKey.fromDER(bufPubkey);
                  fOk = this.verifySignature(sig, pubkey, subscript);
                } catch (e) {
                  fOk = false;
                }
              }
              if (fOk) {
                isig++;
                nSigsCount--;
              }
              ikey++;
              nKeysCount--;
              if (nSigsCount > nKeysCount) {
                fSuccess = false;
              }
            }
            const itemsConsumedByOp = 1 + // N_val
            declaredKeyCount + // keys
            1 + // M_val
            declaredSigCount + // sigs
            1;
            let popCount = itemsConsumedByOp - 1;
            while (popCount > 0) {
              this.popStack();
              popCount--;
            }
            if (this.stack.length < 1) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires an extra item (dummy) to be on the stack.`);
            }
            const dummyBuf = this.popStack();
            if (dummyBuf.length > 0) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the extra stack item (dummy) to be empty.`);
            }
            this.pushStack(fSuccess ? [1] : []);
            if (currentOpcode === OP_default.OP_CHECKMULTISIGVERIFY) {
              if (!fSuccess)
                this.scriptEvaluationError("OP_CHECKMULTISIGVERIFY requires that a sufficient number of valid signatures are provided.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_CAT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_CAT requires at least two items to be on the stack.");
            buf2 = this.popStack();
            buf1 = this.popStack();
            const catResult = buf1.concat(buf2);
            if (catResult.length > maxScriptElementSize)
              this.scriptEvaluationError(`It's not currently possible to push data larger than ${maxScriptElementSize} bytes.`);
            this.pushStack(catResult);
            break;
          }
          case OP_default.OP_SPLIT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_SPLIT requires at least two items to be on the stack.");
            const posBuf = this.popStack();
            const dataToSplit = this.popStack();
            const splitIndexBigInt = BigNumber.fromScriptNum(posBuf, requireMinimalPush).toBigInt();
            if (splitIndexBigInt < 0n || splitIndexBigInt > BigInt(dataToSplit.length)) {
              this.scriptEvaluationError("OP_SPLIT requires the first stack item to be a non-negative number less than or equal to the size of the second-from-top stack item.");
            }
            const splitIndex = Number(splitIndexBigInt);
            this.pushStack(dataToSplit.slice(0, splitIndex));
            this.pushStack(dataToSplit.slice(splitIndex));
            break;
          }
          case OP_default.OP_NUM2BIN: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_NUM2BIN requires at least two items to be on the stack.");
            const sizeBigInt = BigNumber.fromScriptNum(this.popStack(), requireMinimalPush).toBigInt();
            if (sizeBigInt > BigInt(maxScriptElementSize) || sizeBigInt < 0n) {
              this.scriptEvaluationError(`It's not currently possible to push data larger than ${maxScriptElementSize} bytes or negative size.`);
            }
            size = Number(sizeBigInt);
            let rawnum = this.popStack();
            rawnum = minimallyEncode(rawnum);
            if (rawnum.length > size) {
              this.scriptEvaluationError("OP_NUM2BIN requires that the size expressed in the top stack item is large enough to hold the value expressed in the second-from-top stack item.");
            }
            if (rawnum.length === size) {
              this.pushStack(rawnum);
              break;
            }
            const resultN2B = new Array(size).fill(0);
            let signbit = 0;
            if (rawnum.length > 0) {
              signbit = rawnum[rawnum.length - 1] & 128;
              rawnum[rawnum.length - 1] &= 127;
            }
            for (let k = 0; k < rawnum.length; k++) {
              resultN2B[k] = rawnum[k];
            }
            if (signbit !== 0) {
              resultN2B[size - 1] |= 128;
            }
            this.pushStack(resultN2B);
            break;
          }
          case OP_default.OP_BIN2NUM: {
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_BIN2NUM requires at least one item to be on the stack.");
            buf1 = this.popStack();
            const b2nResult = minimallyEncode(buf1);
            if (!isMinimallyEncodedHelper(b2nResult)) {
              this.scriptEvaluationError("OP_BIN2NUM requires that the resulting number is valid.");
            }
            this.pushStack(b2nResult);
            break;
          }
          default:
            this.scriptEvaluationError(`Invalid opcode ${currentOpcode} (pc=${this.programCounter}).`);
        }
      }
      this.programCounter++;
      return true;
    }
    /**
     * @method validate
     * Validates the spend action by interpreting the locking and unlocking scripts.
     * @returns {boolean} Returns true if the scripts are valid and the spend is legitimate, otherwise false.
     * @example
     * if (spend.validate()) {
     *   console.log("Spend is valid!");
     * } else {
     *   console.log("Invalid spend!");
     * }
     */
    validate() {
      if (requirePushOnlyUnlockingScripts && !this.unlockingScript.isPushOnly()) {
        this.scriptEvaluationError("Unlocking scripts can only contain push operations, and no other opcodes.");
      }
      while (this.step()) {
        if (this.context === "LockingScript" && this.programCounter >= this.lockingScript.chunks.length) {
          break;
        }
      }
      if (this.ifStack.length > 0) {
        this.scriptEvaluationError("Every OP_IF, OP_NOTIF, or OP_ELSE must be terminated with OP_ENDIF prior to the end of the script.");
      }
      if (requireCleanStack) {
        if (this.stack.length !== 1) {
          this.scriptEvaluationError(`The clean stack rule requires exactly one item to be on the stack after script execution, found ${this.stack.length}.`);
        }
      }
      if (this.stack.length === 0) {
        this.scriptEvaluationError("The top stack element must be truthy after script evaluation (stack is empty).");
      } else if (!this.castToBool(this.stackTop())) {
        this.scriptEvaluationError("The top stack element must be truthy after script evaluation.");
      }
      return true;
    }
    castToBool(val) {
      if (val.length === 0)
        return false;
      for (let i = 0; i < val.length; i++) {
        if (val[i] !== 0) {
          return !(i === val.length - 1 && val[i] === 128);
        }
      }
      return false;
    }
    scriptEvaluationError(str) {
      throw new ScriptEvaluationError({
        message: str,
        txid: this.sourceTXID,
        outputIndex: this.sourceOutputIndex,
        context: this.context,
        programCounter: this.programCounter,
        stackState: this.stack,
        altStackState: this.altStack,
        ifStackState: this.ifStack,
        stackMem: this.stackMem,
        altStackMem: this.altStackMem
      });
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/templates/P2PKH.js
  var P2PKH = class {
    /**
     * Creates a P2PKH locking script for a given public key hash or address string
     *
     * @param {number[] | string} pubkeyhash or address - An array or address representing the public key hash.
     * @returns {LockingScript} - A P2PKH locking script.
     */
    lock(pubkeyhash) {
      let data;
      if (typeof pubkeyhash === "string") {
        const hash = fromBase58Check(pubkeyhash);
        if (hash.prefix[0] !== 0 && hash.prefix[0] !== 111) {
          throw new Error("only P2PKH is supported");
        }
        data = hash.data;
      } else {
        data = pubkeyhash;
      }
      if (data.length !== 20) {
        throw new Error("P2PKH hash length must be 20 bytes");
      }
      return new LockingScript([
        { op: OP_default.OP_DUP },
        { op: OP_default.OP_HASH160 },
        { op: data.length, data },
        { op: OP_default.OP_EQUALVERIFY },
        { op: OP_default.OP_CHECKSIG }
      ]);
    }
    /**
     * Creates a function that generates a P2PKH unlocking script along with its signature and length estimation.
     *
     * The returned object contains:
     * 1. `sign` - A function that, when invoked with a transaction and an input index,
     *    produces an unlocking script suitable for a P2PKH locked output.
     * 2. `estimateLength` - A function that returns the estimated length of the unlocking script in bytes.
     *
     * @param {PrivateKey} privateKey - The private key used for signing the transaction.
     * @param {'all'|'none'|'single'} signOutputs - The signature scope for outputs.
     * @param {boolean} anyoneCanPay - Flag indicating if the signature allows for other inputs to be added later.
     * @param {number} sourceSatoshis - Optional. The amount being unlocked. Otherwise the input.sourceTransaction is required.
     * @param {Script} lockingScript - Optional. The lockinScript. Otherwise the input.sourceTransaction is required.
     * @returns {Object} - An object containing the `sign` and `estimateLength` functions.
     */
    unlock(privateKey, signOutputs = "all", anyoneCanPay = false, sourceSatoshis, lockingScript) {
      return {
        sign: async (tx, inputIndex) => {
          let signatureScope = TransactionSignature.SIGHASH_FORKID;
          if (signOutputs === "all") {
            signatureScope |= TransactionSignature.SIGHASH_ALL;
          }
          if (signOutputs === "none") {
            signatureScope |= TransactionSignature.SIGHASH_NONE;
          }
          if (signOutputs === "single") {
            signatureScope |= TransactionSignature.SIGHASH_SINGLE;
          }
          if (anyoneCanPay) {
            signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY;
          }
          const input = tx.inputs[inputIndex];
          const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex);
          const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
          if (sourceTXID == null || sourceTXID === void 0) {
            throw new Error("The input sourceTXID or sourceTransaction is required for transaction signing.");
          }
          if (sourceTXID === "") {
            throw new Error("The input sourceTXID or sourceTransaction is required for transaction signing.");
          }
          sourceSatoshis || (sourceSatoshis = input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis);
          if (sourceSatoshis == null || sourceSatoshis === void 0) {
            throw new Error("The sourceSatoshis or input sourceTransaction is required for transaction signing.");
          }
          lockingScript || (lockingScript = input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript);
          if (lockingScript == null) {
            throw new Error("The lockingScript or input sourceTransaction is required for transaction signing.");
          }
          const preimage = TransactionSignature.format({
            sourceTXID,
            sourceOutputIndex: verifyNotNull(input.sourceOutputIndex, "input.sourceOutputIndex must have value"),
            sourceSatoshis,
            transactionVersion: tx.version,
            otherInputs,
            inputIndex,
            outputs: tx.outputs,
            inputSequence: verifyNotNull(input.sequence, "input.sequence must have value"),
            subscript: lockingScript,
            lockTime: tx.lockTime,
            scope: signatureScope
          });
          const rawSignature = privateKey.sign(sha256(preimage));
          const sig = new TransactionSignature(rawSignature.r, rawSignature.s, signatureScope);
          const sigForScript = sig.toChecksigFormat();
          const pubkeyForScript = privateKey.toPublicKey().encode(true);
          return new UnlockingScript([
            { op: sigForScript.length, data: sigForScript },
            { op: pubkeyForScript.length, data: pubkeyForScript }
          ]);
        },
        estimateLength: async () => {
          return 108;
        }
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/fee-models/SatoshisPerKilobyte.js
  var SatoshisPerKilobyte = class {
    /**
     * Constructs an instance of the sat/kb fee model.
     *
     * @param {number} value - The number of satoshis per kilobyte to charge as a fee.
     */
    constructor(value) {
      /**
       * @property
       * Denotes the number of satoshis paid per kilobyte of transaction size.
       */
      __publicField(this, "value");
      this.value = value;
    }
    /**
     * Computes the fee for a given transaction.
     *
     * @param tx The transaction for which a fee is to be computed.
     * @returns The fee in satoshis for the transaction, as a BigNumber.
     */
    async computeFee(tx) {
      const getVarIntSize = (i) => {
        if (i > 2 ** 32) {
          return 9;
        } else if (i > 2 ** 16) {
          return 5;
        } else if (i > 253) {
          return 3;
        } else {
          return 1;
        }
      };
      let size = 4;
      size += getVarIntSize(tx.inputs.length);
      for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        size += 40;
        let scriptLength;
        if (typeof input.unlockingScript === "object") {
          scriptLength = input.unlockingScript.toBinary().length;
        } else if (typeof input.unlockingScriptTemplate === "object") {
          scriptLength = await input.unlockingScriptTemplate.estimateLength(tx, i);
        } else {
          throw new Error("All inputs must have an unlocking script or an unlocking script template for sat/kb fee computation.");
        }
        size += getVarIntSize(scriptLength);
        size += scriptLength;
      }
      size += getVarIntSize(tx.outputs.length);
      for (const out of tx.outputs) {
        size += 8;
        const length = out.lockingScript.toBinary().length;
        size += getVarIntSize(length);
        size += length;
      }
      size += 4;
      const fee = Math.ceil(size / 1e3 * this.value);
      return fee;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/fee-models/LivePolicy.js
  var _LivePolicy = class _LivePolicy extends SatoshisPerKilobyte {
    /**
     * Constructs an instance of the live policy fee model.
     *
     * @param {number} cacheValidityMs - How long to cache the fee rate in milliseconds (default: 5 minutes)
     */
    constructor(cacheValidityMs = 5 * 60 * 1e3) {
      super(100);
      __publicField(this, "cachedRate", null);
      __publicField(this, "cacheTimestamp", 0);
      __publicField(this, "cacheValidityMs");
      this.cacheValidityMs = cacheValidityMs;
    }
    /**
     * Gets the singleton instance of LivePolicy to ensure cache sharing across the application.
     *
     * @param {number} cacheValidityMs - How long to cache the fee rate in milliseconds (default: 5 minutes)
     * @returns The singleton LivePolicy instance
     */
    static getInstance(cacheValidityMs = 5 * 60 * 1e3) {
      if (!_LivePolicy.instance) {
        _LivePolicy.instance = new _LivePolicy(cacheValidityMs);
      }
      return _LivePolicy.instance;
    }
    /**
     * Fetches the current fee rate from ARC GorillaPool API.
     *
     * @returns The current satoshis per kilobyte rate
     */
    async fetchFeeRate() {
      const now = Date.now();
      if (this.cachedRate !== null && now - this.cacheTimestamp < this.cacheValidityMs) {
        return this.cachedRate;
      }
      try {
        const response = await fetch(_LivePolicy.ARC_POLICY_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const response_data = await response.json();
        if (!response_data.policy?.miningFee || typeof response_data.policy.miningFee.satoshis !== "number" || typeof response_data.policy.miningFee.bytes !== "number") {
          throw new Error("Invalid policy response format");
        }
        const rate = response_data.policy.miningFee.satoshis / response_data.policy.miningFee.bytes * 1e3;
        this.cachedRate = rate;
        this.cacheTimestamp = now;
        return rate;
      } catch (error) {
        if (this.cachedRate !== null) {
          console.warn("Failed to fetch live fee rate, using cached value:", error);
          return this.cachedRate;
        }
        console.warn("Failed to fetch live fee rate, using default 100 sat/kb:", error);
        return 100;
      }
    }
    /**
     * Computes the fee for a given transaction using the current live rate.
     * Overrides the parent method to use dynamic rate fetching.
     *
     * @param tx The transaction for which a fee is to be computed.
     * @returns The fee in satoshis for the transaction.
     */
    async computeFee(tx) {
      const rate = await this.fetchFeeRate();
      this.value = rate;
      return super.computeFee(tx);
    }
  };
  __publicField(_LivePolicy, "ARC_POLICY_URL", "https://arc.gorillapool.io/v1/policy");
  __publicField(_LivePolicy, "instance", null);
  var LivePolicy = _LivePolicy;

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/NodejsHttpClient.js
  var NodejsHttpClient = class {
    constructor(https) {
      __publicField(this, "https");
      this.https = https;
    }
    async request(url, requestOptions) {
      return await new Promise((resolve, reject) => {
        const req = this.https.request(url, requestOptions, (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            const ok = res.statusCode >= 200 && res.statusCode <= 299;
            const mediaType = res.headers["content-type"];
            const data = body !== "" && typeof mediaType === "string" && mediaType.startsWith("application/json") ? JSON.parse(body) : body;
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              ok,
              data
            });
          });
        });
        req.on("error", (error) => {
          reject(error);
        });
        if (requestOptions.data !== null && requestOptions.data !== void 0) {
          req.write(JSON.stringify(requestOptions.data));
        }
        req.end();
      });
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/FetchHttpClient.js
  var FetchHttpClient = class {
    constructor(fetch2) {
      __publicField(this, "fetch");
      this.fetch = fetch2;
    }
    async request(url, options) {
      const fetchOptions = {
        method: options.method,
        headers: options.headers,
        body: JSON.stringify(options.data)
      };
      const res = await this.fetch(url, fetchOptions);
      const mediaType = res.headers.get("Content-Type");
      const data = mediaType?.startsWith("application/json") ?? false ? await res.json() : await res.text();
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        data
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/DefaultHttpClient.js
  function defaultHttpClient() {
    const noHttpClient = {
      async request(..._) {
        throw new Error("No method available to perform HTTP request");
      }
    };
    if (typeof window !== "undefined" && typeof window.fetch === "function") {
      return new FetchHttpClient(window.fetch.bind(window));
    } else if (typeof __require !== "undefined") {
      try {
        const https = __require("https");
        return new NodejsHttpClient(https);
      } catch (e) {
        return noHttpClient;
      }
    } else {
      return noHttpClient;
    }
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/broadcasters/ARC.js
  function defaultDeploymentId() {
    return `ts-sdk-${toHex(Random_default(16))}`;
  }
  var ARC = class {
    constructor(URL2, config) {
      __publicField(this, "URL");
      __publicField(this, "apiKey");
      __publicField(this, "deploymentId");
      __publicField(this, "callbackUrl");
      __publicField(this, "callbackToken");
      __publicField(this, "headers");
      __publicField(this, "httpClient");
      this.URL = URL2;
      if (typeof config === "string") {
        this.apiKey = config;
        this.httpClient = defaultHttpClient();
        this.deploymentId = defaultDeploymentId();
        this.callbackToken = void 0;
        this.callbackUrl = void 0;
      } else {
        const configObj = config ?? {};
        const { apiKey, deploymentId, httpClient, callbackToken, callbackUrl, headers } = configObj;
        this.apiKey = apiKey;
        this.httpClient = httpClient ?? defaultHttpClient();
        this.deploymentId = deploymentId ?? defaultDeploymentId();
        this.callbackToken = callbackToken;
        this.callbackUrl = callbackUrl;
        this.headers = headers;
      }
    }
    /**
     * Constructs a dictionary of the default & supplied request headers.
     */
    requestHeaders() {
      const headers = {
        "Content-Type": "application/json",
        "XDeployment-ID": this.deploymentId
      };
      if (this.apiKey != null && this.apiKey !== "") {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      if (this.callbackUrl != null && this.callbackUrl !== "") {
        headers["X-CallbackUrl"] = this.callbackUrl;
      }
      if (this.callbackToken != null && this.callbackToken !== "") {
        headers["X-CallbackToken"] = this.callbackToken;
      }
      if (this.headers != null) {
        for (const key in this.headers) {
          headers[key] = this.headers[key];
        }
      }
      return headers;
    }
    /**
     * Broadcasts a transaction via ARC.
     *
     * @param {Transaction} tx - The transaction to be broadcasted.
     * @returns {Promise<BroadcastResponse | BroadcastFailure>} A promise that resolves to either a success or failure response.
     */
    async broadcast(tx) {
      let rawTx;
      try {
        rawTx = tx.toHexEF();
      } catch (error) {
        if (error.message === "All inputs must have source transactions when serializing to EF format") {
          rawTx = tx.toHex();
        } else {
          throw error;
        }
      }
      const requestOptions = {
        method: "POST",
        headers: this.requestHeaders(),
        data: { rawTx }
      };
      try {
        const response = await this.httpClient.request(`${this.URL}/v1/tx`, requestOptions);
        if (response.ok) {
          const { txid, extraInfo, txStatus, competingTxs } = response.data;
          const errorStatuses = [
            "DOUBLE_SPEND_ATTEMPTED",
            "REJECTED",
            "INVALID",
            "MALFORMED",
            "MINED_IN_STALE_BLOCK"
          ];
          const isOrphan = extraInfo?.toUpperCase().includes("ORPHAN") || txStatus?.toUpperCase().includes("ORPHAN");
          if (errorStatuses.includes(txStatus?.toUpperCase()) || isOrphan) {
            const failure = {
              status: "error",
              code: txStatus ?? "UNKNOWN",
              txid,
              description: `${txStatus ?? ""} ${extraInfo ?? ""}`.trim()
            };
            if (competingTxs != null) {
              failure.more = { competingTxs };
            }
            return failure;
          }
          const broadcastRes = {
            status: "success",
            txid,
            message: `${txStatus} ${extraInfo}`
          };
          if (competingTxs != null) {
            broadcastRes.competingTxs = competingTxs;
          }
          return broadcastRes;
        } else {
          const st = typeof response.status;
          const r2 = {
            status: "error",
            code: st === "number" || st === "string" ? response.status.toString() : "ERR_UNKNOWN",
            description: "Unknown error"
          };
          let d = response.data;
          if (typeof d === "string") {
            try {
              d = JSON.parse(response.data);
            } catch {
            }
          }
          if (typeof d === "object") {
            if (d !== null) {
              r2.more = d;
            }
            if (d != null && typeof d.txid === "string") {
              r2.txid = d.txid;
            }
            if (d != null && "detail" in d && typeof d.detail === "string") {
              r2.description = d.detail;
            }
          }
          return r2;
        }
      } catch (error) {
        return {
          status: "error",
          code: "500",
          description: typeof error.message === "string" ? error.message : "Internal Server Error"
        };
      }
    }
    /**
     * Broadcasts multiple transactions via ARC.
     * Handles mixed responses where some transactions succeed and others fail.
     *
     * @param {Transaction[]} txs - Array of transactions to be broadcasted.
     * @returns {Promise<Array<object>>} A promise that resolves to an array of objects.
     */
    async broadcastMany(txs) {
      const rawTxs = txs.map((tx) => {
        try {
          return { rawTx: tx.toHexEF() };
        } catch (error) {
          if (error.message === "All inputs must have source transactions when serializing to EF format") {
            return { rawTx: tx.toHex() };
          }
          throw error;
        }
      });
      const requestOptions = {
        method: "POST",
        headers: this.requestHeaders(),
        data: rawTxs
      };
      try {
        const response = await this.httpClient.request(`${this.URL}/v1/txs`, requestOptions);
        return response.data;
      } catch (error) {
        const errorResponse = {
          status: "error",
          code: "500",
          description: typeof error.message === "string" ? error.message : "Internal Server Error"
        };
        return txs.map(() => errorResponse);
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/broadcasters/DefaultBroadcaster.js
  function defaultBroadcaster(isTestnet = false, config = {}) {
    return new ARC(isTestnet ? "https://testnet.arc.gorillapool.io" : "https://arc.gorillapool.io", config);
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/chaintrackers/WhatsOnChain.js
  var WhatsOnChain = class {
    /**
     * Constructs an instance of the WhatsOnChain ChainTracker.
     *
     * @param {'main' | 'test' | 'stn'} network - The BSV network to use when calling the WhatsOnChain API.
     * @param {WhatsOnChainConfig} config - Configuration options for the WhatsOnChain ChainTracker.
     */
    constructor(network = "main", config = {}) {
      __publicField(this, "network");
      __publicField(this, "apiKey");
      __publicField(this, "URL");
      __publicField(this, "httpClient");
      const { apiKey, httpClient } = config;
      this.network = network;
      this.URL = `https://api.whatsonchain.com/v1/bsv/${network}`;
      this.httpClient = httpClient ?? defaultHttpClient();
      this.apiKey = apiKey ?? "";
    }
    async isValidRootForHeight(root, height) {
      const requestOptions = {
        method: "GET",
        headers: this.getHttpHeaders()
      };
      const response = await this.httpClient.request(`${this.URL}/block/${height}/header`, requestOptions);
      if (response.ok) {
        const { merkleroot } = response.data;
        return merkleroot === root;
      } else if (response.status === 404) {
        return false;
      } else {
        throw new Error(`Failed to verify merkleroot for height ${height} because of an error: ${JSON.stringify(response.data)} `);
      }
    }
    async currentHeight() {
      try {
        const requestOptions = {
          method: "GET",
          headers: this.getHttpHeaders()
        };
        const response = await this.httpClient.request(`${this.URL}/block/headers`, requestOptions);
        if (response.ok) {
          return response.data[0].height;
        } else {
          throw new Error(`Failed to get current height because of an error: ${JSON.stringify(response.data)} `);
        }
      } catch (error) {
        throw new Error(`Failed to get current height because of an error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    getHttpHeaders() {
      const headers = {
        Accept: "application/json"
      };
      if (typeof this.apiKey === "string" && this.apiKey.trim() !== "") {
        headers.Authorization = this.apiKey;
      }
      return headers;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/chaintrackers/DefaultChainTracker.js
  function defaultChainTracker() {
    return new WhatsOnChain();
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/MerklePath.js
  var MerklePath = class _MerklePath {
    constructor(blockHeight, path, legalOffsetsOnly = true) {
      __publicField(this, "blockHeight");
      __publicField(this, "path");
      this.blockHeight = blockHeight;
      this.path = path;
      const legalOffsets = Array(this.path.length).fill(0).map(() => /* @__PURE__ */ new Set());
      this.path.forEach((leaves, height) => {
        if (leaves.length === 0 && height === 0) {
          throw new Error(`Empty level at height: ${height}`);
        }
        const offsetsAtThisHeight = /* @__PURE__ */ new Set();
        leaves.forEach((leaf) => {
          if (offsetsAtThisHeight.has(leaf.offset)) {
            throw new Error(`Duplicate offset: ${leaf.offset}, at height: ${height}`);
          }
          offsetsAtThisHeight.add(leaf.offset);
          if (height === 0) {
            if (leaf.duplicate !== true) {
              for (let h = 1; h < this.path.length; h++) {
                legalOffsets[h].add(leaf.offset >> h ^ 1);
              }
            }
          } else {
            if (legalOffsetsOnly && !legalOffsets[height].has(leaf.offset)) {
              throw new Error(`Invalid offset: ${leaf.offset}, at height: ${height}, with legal offsets: ${Array.from(legalOffsets[height]).join(", ")}`);
            }
          }
        });
      });
      let root;
      this.path[0].forEach((leaf, idx) => {
        if (idx === 0)
          root = this.computeRoot(leaf.hash);
        if (root !== this.computeRoot(leaf.hash)) {
          throw new Error("Mismatched roots");
        }
      });
    }
    /**
     * Creates a MerklePath instance from a hexadecimal string.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the Merkle Path.
     * @returns {MerklePath} - A new MerklePath instance.
     */
    static fromHex(hex) {
      return _MerklePath.fromBinary(toArray2(hex, "hex"));
    }
    static fromReader(reader, legalOffsetsOnly = true) {
      const blockHeight = reader.readVarIntNum();
      const treeHeight = reader.readUInt8();
      const path = Array(treeHeight).fill(null).map(() => []);
      let flags, offset, nLeavesAtThisHeight;
      for (let level = 0; level < treeHeight; level++) {
        nLeavesAtThisHeight = reader.readVarIntNum();
        while (nLeavesAtThisHeight > 0) {
          offset = reader.readVarIntNum();
          flags = reader.readUInt8();
          const leaf = { offset };
          if ((flags & 1) !== 0) {
            leaf.duplicate = true;
          } else {
            if ((flags & 2) !== 0) {
              leaf.txid = true;
            }
            leaf.hash = toHex(reader.read(32).reverse());
          }
          if (!Array.isArray(path[level]) || path[level].length === 0) {
            path[level] = [];
          }
          path[level].push(leaf);
          nLeavesAtThisHeight--;
        }
        path[level].sort((a, b) => a.offset - b.offset);
      }
      return new _MerklePath(blockHeight, path, legalOffsetsOnly);
    }
    /**
     * Creates a MerklePath instance from a binary array.
     *
     * @static
     * @param {number[]} bump - The binary array representation of the Merkle Path.
     * @returns {MerklePath} - A new MerklePath instance.
     */
    static fromBinary(bump) {
      const reader = new ReaderUint8Array(bump);
      return _MerklePath.fromReader(reader);
    }
    /**
     *
     * @static fromCoinbaseTxid
     *
     * Creates a MerklePath instance for a coinbase transaction in an empty block.
     * This edge case is difficult to retrieve from standard APIs.
     *
     * @param {string} txid - The coinbase txid.
     * @param {number} height - The height of the block.
     * @returns {MerklePath} - A new MerklePath instance which assumes the tx is in a block with no other transactions.
     */
    static fromCoinbaseTxidAndHeight(txid, height) {
      return new _MerklePath(height, [[{ offset: 0, hash: txid, txid: true }]]);
    }
    /**
     * Serializes the MerklePath to the writer provided.
     *
     * @param writer - The writer to which the Merkle Path will be serialized.
     */
    toWriter(writer) {
      writer.writeVarIntNum(this.blockHeight);
      const treeHeight = this.path.length;
      writer.writeUInt8(treeHeight);
      for (let level = 0; level < treeHeight; level++) {
        const nLeaves = Object.keys(this.path[level]).length;
        writer.writeVarIntNum(nLeaves);
        for (const leaf of this.path[level]) {
          writer.writeVarIntNum(leaf.offset);
          let flags = 0;
          if (leaf?.duplicate === true) {
            flags |= 1;
          }
          if (leaf?.txid !== void 0 && leaf.txid !== null) {
            flags |= 2;
          }
          writer.writeUInt8(flags);
          if ((flags & 1) === 0) {
            writer.write(toArray2(leaf.hash, "hex").reverse());
          }
        }
      }
    }
    /**
     * Converts the MerklePath to a binary array format.
     *
     * @returns {number[]} - The binary array representation of the Merkle Path.
     */
    toBinary() {
      const writer = new Writer();
      this.toWriter(writer);
      return writer.toArray();
    }
    /**
     * Converts the MerklePath to a binary array format.
     *
     * @returns {Uint8Array} - The binary array representation of the Merkle Path.
     */
    toBinaryUint8Array() {
      const writer = new WriterUint8Array();
      this.toWriter(writer);
      return writer.toUint8Array();
    }
    /**
     * Converts the MerklePath to a hexadecimal string format.
     *
     * @returns {string} - The hexadecimal string representation of the Merkle Path.
     */
    toHex() {
      return toHex(this.toBinaryUint8Array());
    }
    //
    indexOf(txid) {
      const leaf = this.path[0].find((l) => l.hash === txid);
      if (leaf === null || leaf === void 0) {
        throw new Error(`Transaction ID ${txid} not found in the Merkle Path`);
      }
      return leaf.offset;
    }
    /**
     * Computes the Merkle root from the provided transaction ID.
     *
     * @param {string} txid - The transaction ID to compute the Merkle root for. If not provided, the root will be computed from an unspecified branch, and not all branches will be validated!
     * @returns {string} - The computed Merkle root as a hexadecimal string.
     * @throws {Error} - If the transaction ID is not part of the Merkle Path.
     */
    computeRoot(txid) {
      if (typeof txid !== "string") {
        const foundLeaf = this.path[0].find((leaf) => Boolean(leaf?.hash));
        if (foundLeaf === null || foundLeaf === void 0) {
          throw new Error("No valid leaf found in the Merkle Path");
        }
        txid = foundLeaf.hash;
      }
      if (typeof txid !== "string") {
        throw new Error("Transaction ID is undefined");
      }
      const index = this.indexOf(txid);
      if (typeof index !== "number") {
        throw new Error(`This proof does not contain the txid: ${txid ?? "undefined"}`);
      }
      const hash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      let workingHash = txid;
      if (this.path.length === 1 && this.path[0].length === 1)
        return workingHash;
      for (let height = 0; height < this.path.length; height++) {
        const leaves = this.path[height];
        const offset = index >> height ^ 1;
        const leaf = this.findOrComputeLeaf(height, offset);
        if (typeof leaf !== "object") {
          throw new Error(`Missing hash for index ${index} at height ${height}`);
        }
        if (leaf.duplicate === true) {
          workingHash = hash((workingHash ?? "") + (workingHash ?? ""));
        } else if (offset % 2 !== 0) {
          workingHash = hash((leaf.hash ?? "") + (workingHash ?? ""));
        } else {
          workingHash = hash((workingHash ?? "") + (leaf.hash ?? ""));
        }
      }
      return workingHash;
    }
    /**
     * Find leaf with `offset` at `height` or compute from level below, recursively.
     *
     * Does not add computed leaves to path.
     *
     * @param height
     * @param offset
     */
    findOrComputeLeaf(height, offset) {
      const hash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      let leaf = this.path[height].find((l2) => l2.offset === offset);
      if (leaf != null)
        return leaf;
      if (height === 0)
        return void 0;
      const h = height - 1;
      const l = offset << 1;
      const leaf0 = this.findOrComputeLeaf(h, l);
      if (leaf0 == null || leaf0.hash == null || leaf0.hash === "")
        return void 0;
      const leaf1 = this.findOrComputeLeaf(h, l + 1);
      if (leaf1 == null)
        return void 0;
      let workinghash;
      if (leaf1.duplicate === true) {
        workinghash = hash(leaf0.hash + leaf0.hash);
      } else {
        workinghash = hash((leaf1.hash ?? "") + (leaf0.hash ?? ""));
      }
      leaf = {
        offset,
        hash: workinghash
      };
      return leaf;
    }
    /**
     * Verifies if the given transaction ID is part of the Merkle tree at the specified block height.
     *
     * @param {string} txid - The transaction ID to verify.
     * @param {ChainTracker} chainTracker - The ChainTracker instance used to verify the Merkle root.
     * @returns {boolean} - True if the transaction ID is valid within the Merkle Path at the specified block height.
     */
    async verify(txid, chainTracker) {
      const root = this.computeRoot(txid);
      if (this.indexOf(txid) === 0) {
        const height = await chainTracker.currentHeight();
        if (this.blockHeight + 100 < height) {
          return false;
        }
      }
      return await chainTracker.isValidRootForHeight(root, this.blockHeight);
    }
    /**
     * Combines this MerklePath with another to create a compound proof.
     *
     * @param {MerklePath} other - Another MerklePath to combine with this path.
     * @throws {Error} - If the paths have different block heights or roots.
     */
    combine(other) {
      if (this.blockHeight !== other.blockHeight) {
        throw new Error("You cannot combine paths which do not have the same block height.");
      }
      const root1 = this.computeRoot();
      const root2 = other.computeRoot();
      if (root1 !== root2) {
        throw new Error("You cannot combine paths which do not have the same root.");
      }
      const combinedPath = [];
      for (let h = 0; h < this.path.length; h++) {
        combinedPath.push([]);
        for (let l = 0; l < this.path[h].length; l++) {
          combinedPath[h].push(this.path[h][l]);
        }
        for (let l = 0; l < other.path[h].length; l++) {
          if (combinedPath[h].find((leaf) => leaf.offset === other.path[h][l].offset) === void 0) {
            combinedPath[h].push(other.path[h][l]);
          } else {
            if (other.path[h][l]?.txid !== void 0 && other.path[h][l]?.txid !== null) {
              const target = combinedPath[h].find((leaf) => leaf.offset === other.path[h][l].offset);
              if (target !== null && target !== void 0) {
                target.txid = true;
              }
            }
          }
        }
      }
      this.path = combinedPath;
      this.trim();
    }
    /**
     * Remove all internal nodes that are not required by level zero txid nodes.
     * Assumes that at least all required nodes are present.
     * Leaves all levels sorted by increasing offset.
     */
    trim() {
      const pushIfNew = (v, a) => {
        if (a.length === 0 || a.slice(-1)[0] !== v) {
          a.push(v);
        }
      };
      const dropOffsetsFromLevel = (dropOffsets2, level) => {
        for (let i = dropOffsets2.length; i >= 0; i--) {
          const l = this.path[level].findIndex((n) => n.offset === dropOffsets2[i]);
          if (l >= 0) {
            this.path[level].splice(l, 1);
          }
        }
      };
      const nextComputedOffsets = (cos) => {
        const ncos = [];
        for (const o of cos) {
          pushIfNew(o >> 1, ncos);
        }
        return ncos;
      };
      let computedOffsets = [];
      let dropOffsets = [];
      for (let h = 0; h < this.path.length; h++) {
        this.path[h].sort((a, b) => a.offset - b.offset);
      }
      for (let l = 0; l < this.path[0].length; l++) {
        const n = this.path[0][l];
        if (n.txid === true) {
          pushIfNew(n.offset >> 1, computedOffsets);
        } else {
          const isOdd = n.offset % 2 === 1;
          const peer = this.path[0][l + (isOdd ? -1 : 1)];
          if (peer.txid === void 0 || peer.txid === null || !peer.txid) {
            pushIfNew(peer.offset, dropOffsets);
          }
        }
      }
      dropOffsetsFromLevel(dropOffsets, 0);
      for (let h = 1; h < this.path.length; h++) {
        dropOffsets = computedOffsets;
        computedOffsets = nextComputedOffsets(computedOffsets);
        dropOffsetsFromLevel(dropOffsets, h);
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/BeefTx.js
  var BeefTx = class _BeefTx {
    /**
     * @param tx If string, must be a valid txid. If `number[]` must be a valid serialized transaction.
     * @param bumpIndex If transaction already has a proof in the beef to which it will be added.
     */
    constructor(tx, bumpIndex) {
      __publicField(this, "_bumpIndex");
      __publicField(this, "_tx");
      __publicField(this, "_rawTx");
      // ← changed to Uint8Array internally
      __publicField(this, "_txid");
      __publicField(this, "inputTxids", []);
      /**
       * true if `hasProof` or all inputs chain to `hasProof`.
       *
       * Typically set by sorting transactions by proven dependency chains.
       */
      __publicField(this, "isValid");
      if (typeof tx === "string") {
        this._txid = tx;
      } else if (tx instanceof Uint8Array) {
        this._rawTx = tx;
      } else if (Array.isArray(tx)) {
        this._rawTx = new Uint8Array(tx);
      } else if (tx instanceof Transaction) {
        this._tx = tx;
      } else {
        throw new Error("Invalid transaction data type");
      }
      this.bumpIndex = bumpIndex;
      this.updateInputTxids();
    }
    get bumpIndex() {
      return this._bumpIndex;
    }
    set bumpIndex(v) {
      this._bumpIndex = v;
      this.updateInputTxids();
    }
    get hasProof() {
      return this._bumpIndex !== void 0;
    }
    get isTxidOnly() {
      return this._txid !== void 0 && this._txid !== null && this._rawTx == null && this._tx == null;
    }
    get txid() {
      if (this._txid !== void 0 && this._txid !== null && this._txid !== "")
        return this._txid;
      if (this._tx != null) {
        this._txid = this._tx.id("hex");
        return this._txid;
      }
      if (this._rawTx != null) {
        this._txid = toHex(hash256(this._rawTx));
        return this._txid;
      }
      throw new Error("Internal");
    }
    get tx() {
      if (this._tx != null)
        return this._tx;
      if (this._rawTx != null) {
        this._tx = Transaction.fromBinary(this._rawTx);
        return this._tx;
      }
      return void 0;
    }
    /**
     * Legacy compatibility getter — returns number[] (Byte[])
     */
    get rawTx() {
      if (this._rawTx != null) {
        return Array.from(this._rawTx);
      }
      if (this._tx != null) {
        const bytes2 = this._tx.toUint8Array();
        this._rawTx = bytes2;
        return Array.from(bytes2);
      }
      return void 0;
    }
    /**
     * Preferred modern getter — returns Uint8Array (zero-copy where possible)
     */
    get rawTxUint8Array() {
      if (this._rawTx != null)
        return this._rawTx;
      if (this._tx != null) {
        this._rawTx = this._tx.toUint8Array();
        return this._rawTx;
      }
      return void 0;
    }
    static fromTx(tx, bumpIndex) {
      return new _BeefTx(tx, bumpIndex);
    }
    static fromRawTx(rawTx, bumpIndex) {
      return new _BeefTx(rawTx, bumpIndex);
    }
    static fromTxid(txid, bumpIndex) {
      return new _BeefTx(txid, bumpIndex);
    }
    updateInputTxids() {
      if (this.hasProof || this.tx == null) {
        this.inputTxids = [];
      } else {
        const inputTxids = /* @__PURE__ */ new Set();
        for (const input of this.tx.inputs) {
          if (input.sourceTXID !== void 0 && input.sourceTXID !== null && input.sourceTXID !== "") {
            inputTxids.add(input.sourceTXID);
          }
        }
        this.inputTxids = Array.from(inputTxids);
      }
    }
    toWriter(writer, version) {
      const writeByte = (bb) => {
        writer.writeUInt8(bb);
      };
      const writeTxid = () => {
        if (this._txid == null) {
          throw new Error("Transaction ID (_txid) is undefined");
        }
        writer.writeReverse(toArray2(this._txid, "hex"));
      };
      const writeTx = () => {
        const bytes2 = this.rawTxUint8Array;
        if (bytes2 == null) {
          throw new Error("a valid serialized Transaction is expected");
        }
        writer.write(bytes2);
      };
      const writeBumpIndex = () => {
        if (this.bumpIndex === void 0) {
          writeByte(TX_DATA_FORMAT.RAWTX);
        } else {
          writeByte(TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX);
          writer.writeVarIntNum(this.bumpIndex);
        }
      };
      if (version === BEEF_V2) {
        if (this.isTxidOnly) {
          writeByte(TX_DATA_FORMAT.TXID_ONLY);
          writeTxid();
        } else if (this.bumpIndex !== void 0) {
          writeByte(TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX);
          writer.writeVarIntNum(this.bumpIndex);
          writeTx();
        } else {
          writeByte(TX_DATA_FORMAT.RAWTX);
          writeTx();
        }
      } else {
        writeTx();
        writeBumpIndex();
      }
    }
    static fromReader(br, version) {
      let data;
      let bumpIndex;
      let beefTx;
      if (version === BEEF_V2) {
        const format = br.readUInt8();
        if (format === TX_DATA_FORMAT.TXID_ONLY) {
          beefTx = _BeefTx.fromTxid(toHex(br.readReverse(32)));
        } else {
          if (format === TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX) {
            bumpIndex = br.readVarIntNum();
          }
          data = Transaction.fromReader(br);
          beefTx = _BeefTx.fromTx(data, bumpIndex);
        }
      } else {
        data = Transaction.fromReader(br);
        bumpIndex = br.readUInt8() !== 0 ? br.readVarIntNum() : void 0;
        beefTx = _BeefTx.fromTx(data, bumpIndex);
      }
      return beefTx;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/Beef.js
  var BEEF_V1 = 4022206465;
  var BEEF_V2 = 4022206466;
  var ATOMIC_BEEF = 16843009;
  var TX_DATA_FORMAT;
  (function(TX_DATA_FORMAT2) {
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["RAWTX"] = 0] = "RAWTX";
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["RAWTX_AND_BUMP_INDEX"] = 1] = "RAWTX_AND_BUMP_INDEX";
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["TXID_ONLY"] = 2] = "TXID_ONLY";
  })(TX_DATA_FORMAT || (TX_DATA_FORMAT = {}));
  var Beef = class _Beef {
    constructor(version = BEEF_V2) {
      __publicField(this, "bumps", []);
      __publicField(this, "txs", []);
      __publicField(this, "version", BEEF_V2);
      __publicField(this, "atomicTxid");
      __publicField(this, "txidIndex");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      __publicField(this, "needsSort", true);
      this.version = version;
    }
    invalidateSerializationCaches() {
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    markMutated(requiresSort = true) {
      this.invalidateSerializationCaches();
      if (requiresSort) {
        this.needsSort = true;
      }
    }
    ensureSerializableState() {
      for (const tx of this.txs) {
        void tx.txid;
      }
    }
    ensureSortedForSerialization() {
      if (this.needsSort) {
        this.sortTxs();
      }
    }
    getSerializedBytes() {
      this.ensureSerializableState();
      if (this.rawBytesCache == null) {
        this.ensureSortedForSerialization();
        const writer = new WriterUint8Array();
        this.toWriter(writer);
        this.rawBytesCache = writer.toUint8Array();
      }
      return this.rawBytesCache;
    }
    getBeefForAtomic(txid) {
      if (this.needsSort) {
        this.sortTxs();
      }
      const tx = this.findTxid(txid);
      if (tx == null) {
        throw new Error(`${txid} does not exist in this Beef`);
      }
      const beef = this.txs[this.txs.length - 1] === tx ? this : this.clone();
      if (beef !== this) {
        const i = this.txs.findIndex((t) => t.txid === txid);
        beef.txs.splice(i + 1);
      }
      const writer = new WriterUint8Array();
      writer.writeUInt32LE(ATOMIC_BEEF);
      writer.writeReverse(toArray2(txid, "hex"));
      return { beef, writer };
    }
    /**
     * @param txid of `beefTx` to find
     * @returns `BeefTx` in `txs` with `txid`.
     */
    findTxid(txid) {
      return this.ensureTxidIndex().get(txid);
    }
    ensureTxidIndex() {
      if (this.txidIndex == null) {
        this.txidIndex = /* @__PURE__ */ new Map();
        for (const tx of this.txs) {
          this.txidIndex.set(tx.txid, tx);
        }
      }
      return this.txidIndex;
    }
    deleteFromIndex(txid) {
      this.txidIndex?.delete(txid);
    }
    addToIndex(tx) {
      this.txidIndex?.set(tx.txid, tx);
    }
    /**
     * Replaces `BeefTx` for this txid with txidOnly.
     *
     * Replacement is done so that a `clone()` can be
     * updated by this method without affecting the
     * original.
     *
     * @param txid
     * @returns undefined if txid is unknown.
     */
    makeTxidOnly(txid) {
      const i = this.txs.findIndex((tx) => tx.txid === txid);
      if (i === -1)
        return void 0;
      let btx = this.txs[i];
      if (btx.isTxidOnly) {
        return btx;
      }
      this.deleteFromIndex(txid);
      this.txs.splice(i, 1);
      this.markMutated(true);
      btx = this.mergeTxidOnly(txid);
      return btx;
    }
    /**
     * @returns `MerklePath` with level zero hash equal to txid or undefined.
     */
    findBump(txid) {
      return this.bumps.find(
        (b) => b.path[0].some((leaf) => leaf.hash === txid)
        // ✅ Ensure boolean return with `.some()`
      );
    }
    /**
     * Finds a Transaction in this `Beef`
     * and adds any missing input SourceTransactions from this `Beef`.
     *
     * The result is suitable for signing.
     *
     * @param txid The id of the target transaction.
     * @returns Transaction with all available input `SourceTransaction`s from this Beef.
     */
    findTransactionForSigning(txid) {
      const beefTx = this.findTxid(txid);
      if (beefTx == null || beefTx.tx == null)
        return void 0;
      for (const i of beefTx.tx.inputs) {
        if (i.sourceTransaction == null) {
          const itx = this.findTxid(verifyNotNull(i.sourceTXID, "sourceTXID must be valid"));
          if (itx != null) {
            i.sourceTransaction = itx.tx;
          }
        }
      }
      return beefTx.tx;
    }
    /**
     * Builds the proof tree rooted at a specific `Transaction`.
     *
     * To succeed, the Beef must contain all the required transaction and merkle path data.
     *
     * @param txid The id of the target transaction.
     * @returns Transaction with input `SourceTransaction` and `MerklePath` populated from this Beef.
     */
    findAtomicTransaction(txid) {
      const beefTx = this.findTxid(txid);
      if (beefTx == null || beefTx.tx == null)
        return void 0;
      const addInputProof = (beef, tx) => {
        const mp = beef.findBump(tx.id("hex"));
        if (mp != null) {
          tx.merklePath = mp;
        } else {
          for (const i of tx.inputs) {
            if (i.sourceTransaction == null) {
              const itx = beef.findTxid(verifyNotNull(i.sourceTXID, "sourceTXID must be valid"));
              if (itx != null) {
                i.sourceTransaction = itx.tx;
              }
            }
            if (i.sourceTransaction != null) {
              const mp2 = beef.findBump(i.sourceTransaction.id("hex"));
              if (mp2 != null) {
                i.sourceTransaction.merklePath = mp2;
              } else {
                addInputProof(beef, i.sourceTransaction);
              }
            }
          }
        }
      };
      addInputProof(this, beefTx.tx);
      return beefTx.tx;
    }
    /**
     * Merge a MerklePath that is assumed to be fully valid.
     * @param bump
     * @returns index of merged bump
     */
    mergeBump(bump) {
      this.markMutated(false);
      let bumpIndex;
      for (let i = 0; i < this.bumps.length; i++) {
        const b2 = this.bumps[i];
        if (b2 === bump) {
          return i;
        }
        if (b2.blockHeight === bump.blockHeight) {
          const rootA = b2.computeRoot();
          const rootB = bump.computeRoot();
          if (rootA === rootB) {
            b2.combine(bump);
            bumpIndex = i;
            break;
          }
        }
      }
      if (bumpIndex === void 0) {
        bumpIndex = this.bumps.length;
        this.bumps.push(bump);
      }
      const b = this.bumps[bumpIndex];
      for (const tx of this.txs) {
        const txid = tx.txid;
        if (tx.bumpIndex == null) {
          for (const n of b.path[0]) {
            if (n.hash === txid) {
              tx.bumpIndex = bumpIndex;
              n.txid = true;
              break;
            }
          }
        }
      }
      return bumpIndex;
    }
    /**
     * Merge a serialized transaction.
     *
     * Checks that a transaction with the same txid hasn't already been merged.
     *
     * Replaces existing transaction with same txid.
     *
     * @param rawTx
     * @param bumpIndex Optional. If a number, must be valid index into bumps array.
     * @returns txid of rawTx
     */
    mergeRawTx(rawTx, bumpIndex) {
      this.markMutated(true);
      const newTx = new BeefTx(rawTx, bumpIndex);
      this.removeExistingTxid(newTx.txid);
      this.txs.push(newTx);
      this.addToIndex(newTx);
      this.tryToValidateBumpIndex(newTx);
      return newTx;
    }
    /**
     * Merge a `Transaction` and any referenced `merklePath` and `sourceTransaction`, recursifely.
     *
     * Replaces existing transaction with same txid.
     *
     * Attempts to match an existing bump to the new transaction.
     *
     * @param tx
     * @returns txid of tx
     */
    mergeTransaction(tx) {
      this.markMutated(true);
      const txid = tx.id("hex");
      this.removeExistingTxid(txid);
      let bumpIndex;
      if (tx.merklePath != null) {
        bumpIndex = this.mergeBump(tx.merklePath);
      }
      const newTx = new BeefTx(tx, bumpIndex);
      this.txs.push(newTx);
      this.addToIndex(newTx);
      this.tryToValidateBumpIndex(newTx);
      bumpIndex = newTx.bumpIndex;
      if (bumpIndex === void 0) {
        for (const input of tx.inputs) {
          if (input.sourceTransaction != null) {
            this.mergeTransaction(input.sourceTransaction);
          }
        }
      }
      return newTx;
    }
    /**
     * Removes an existing transaction from the BEEF, given its TXID
     * @param txid TXID of the transaction to remove
     */
    removeExistingTxid(txid) {
      const existingTxIndex = this.txs.findIndex((t) => t.txid === txid);
      if (existingTxIndex >= 0) {
        this.deleteFromIndex(txid);
        this.txs.splice(existingTxIndex, 1);
        this.markMutated(true);
      }
    }
    mergeTxidOnly(txid) {
      let tx = this.findTxid(txid);
      if (tx == null) {
        tx = new BeefTx(txid);
        this.txs.push(tx);
        this.addToIndex(tx);
        this.tryToValidateBumpIndex(tx);
        this.markMutated(true);
      }
      return tx;
    }
    mergeBeefTx(btx) {
      let beefTx = this.findTxid(btx.txid);
      if (btx.isTxidOnly && beefTx == null) {
        beefTx = this.mergeTxidOnly(btx.txid);
      } else if (btx._tx != null && (beefTx == null || beefTx.isTxidOnly)) {
        beefTx = this.mergeTransaction(btx._tx);
      } else if (btx._rawTx != null && (beefTx == null || beefTx.isTxidOnly)) {
        beefTx = this.mergeRawTx(btx._rawTx);
      }
      if (beefTx == null) {
        throw new Error(`Failed to merge BeefTx for txid: ${btx.txid}`);
      }
      return beefTx;
    }
    mergeBeef(beef) {
      const b = beef instanceof _Beef ? beef : _Beef.fromBinary(beef);
      for (const bump of b.bumps) {
        this.mergeBump(bump);
      }
      for (const tx of b.txs) {
        this.mergeBeefTx(tx);
      }
    }
    /**
     * Sorts `txs` and checks structural validity of beef.
     *
     * Does NOT verify merkle roots.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param allowTxidOnly optional. If true, transaction txid only is assumed valid
     */
    isValid(allowTxidOnly) {
      return this.verifyValid(allowTxidOnly).valid;
    }
    /**
     * Sorts `txs` and confirms validity of transaction data contained in beef
     * by validating structure of this beef and confirming computed merkle roots
     * using `chainTracker`.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param chainTracker Used to verify computed merkle path roots for all bump txids.
     * @param allowTxidOnly optional. If true, transaction txid is assumed valid
     */
    async verify(chainTracker, allowTxidOnly) {
      const r2 = this.verifyValid(allowTxidOnly);
      if (!r2.valid)
        return false;
      for (const height of Object.keys(r2.roots)) {
        const isValid = await chainTracker.isValidRootForHeight(r2.roots[height], Number(height));
        if (!isValid) {
          return false;
        }
      }
      return true;
    }
    /**
     * Sorts `txs` and confirms validity of transaction data contained in beef
     * by validating structure of this beef.
     *
     * Returns block heights and merkle root values to be confirmed by a chaintracker.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param allowTxidOnly optional. If true, transaction txid is assumed valid
     * @returns {{valid: boolean, roots: Record<number, string>}}
     * `valid` is true iff this Beef is structuraly valid.
     * `roots` is a record where keys are block heights and values are the corresponding merkle roots to be validated.
     */
    verifyValid(allowTxidOnly) {
      const r2 = {
        valid: false,
        roots: {}
      };
      const sr = this.sortTxs();
      if (sr.missingInputs.length > 0 || sr.notValid.length > 0 || sr.txidOnly.length > 0 && allowTxidOnly !== true || sr.withMissingInputs.length > 0) {
        return r2;
      }
      const txids = {};
      for (const tx of this.txs) {
        if (tx.isTxidOnly) {
          if (allowTxidOnly !== true)
            return r2;
          txids[tx.txid] = true;
        }
      }
      const confirmComputedRoot = (b, txid) => {
        const root = b.computeRoot(txid);
        if (r2.roots[b.blockHeight] === void 0 || r2.roots[b.blockHeight] === "") {
          r2.roots[b.blockHeight] = root;
        }
        if (r2.roots[b.blockHeight] !== root) {
          return false;
        }
        return true;
      };
      for (const b of this.bumps) {
        for (const n of b.path[0]) {
          if (n.txid === true && typeof n.hash === "string" && n.hash.length > 0) {
            txids[n.hash] = true;
            if (!confirmComputedRoot(b, n.hash)) {
              return r2;
            }
          }
        }
      }
      for (const t of this.txs) {
        if (t.bumpIndex !== void 0) {
          const leaf = this.bumps[t.bumpIndex].path[0].find((l) => l.hash === t.txid);
          if (leaf == null) {
            return r2;
          }
        }
      }
      for (const t of this.txs) {
        for (const i of t.inputTxids) {
          if (!txids[i])
            return r2;
        }
        txids[t.txid] = true;
      }
      r2.valid = true;
      return r2;
    }
    /**
     * Serializes this data to `writer`
     * @param writer
     */
    toWriter(writer) {
      writer.writeUInt32LE(this.version);
      writer.writeVarIntNum(this.bumps.length);
      for (const b of this.bumps) {
        writer.write(b.toBinary());
      }
      writer.writeVarIntNum(this.txs.length);
      for (const tx of this.txs) {
        tx.toWriter(writer, this.version);
      }
    }
    /**
     * Returns a binary array representing the serialized BEEF
     * @returns A binary array representing the BEEF
     * @returns An array of byte values containing binary serialization of the BEEF
     */
    toBinary() {
      return Array.from(this.getSerializedBytes());
    }
    /**
     * Returns a binary array representing the serialized BEEF
     * @returns A Uint8Array containing binary serialization of the BEEF
     */
    toUint8Array() {
      return this.getSerializedBytes();
    }
    /**
     * Serialize this Beef as AtomicBEEF.
     *
     * `txid` must exist
     *
     * after sorting, if txid is not last txid, creates a clone and removes newer txs
     *
     * @param txid
     * @returns serialized contents of this Beef with AtomicBEEF prefix.
     */
    toBinaryAtomic(txid) {
      const { beef, writer } = this.getBeefForAtomic(txid);
      beef.toWriter(writer);
      return writer.toArray();
    }
    /**
     * Serialize this Beef as AtomicBEEF.
     *
     * `txid` must exist
     *
     * after sorting, if txid is not last txid, creates a clone and removes newer txs
     *
     * @param txid
     * @returns serialized contents of this Beef with AtomicBEEF prefix.
     */
    toUint8ArrayAtomic(txid) {
      const { beef, writer } = this.getBeefForAtomic(txid);
      const beefUint8 = beef.getSerializedBytes();
      const prefix = writer.toUint8Array();
      const atomic = new Uint8Array(prefix.length + beefUint8.length);
      atomic.set(prefix, 0);
      atomic.set(beefUint8, prefix.length);
      return atomic;
    }
    /**
     * Returns a hex string representing the serialized BEEF
     * @returns A hex string representing the BEEF
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      const bytes2 = this.getSerializedBytes();
      const hex = toHex(bytes2);
      this.hexCache = hex;
      return hex;
    }
    static fromReader(br) {
      let version = br.readUInt32LE();
      let atomicTxid;
      if (version === ATOMIC_BEEF) {
        atomicTxid = toHex(br.readReverse(32));
        version = br.readUInt32LE();
      }
      if (version !== BEEF_V1 && version !== BEEF_V2) {
        throw new Error(`Serialized BEEF must start with ${BEEF_V1} or ${BEEF_V2} but starts with ${version}`);
      }
      const beef = new _Beef(version);
      const bumpsLength = br.readVarIntNum();
      for (let i = 0; i < bumpsLength; i++) {
        const bump = MerklePath.fromReader(br, false);
        beef.bumps.push(bump);
      }
      const txsLength = br.readVarIntNum();
      for (let i = 0; i < txsLength; i++) {
        const beefTx = BeefTx.fromReader(br, version);
        beef.txs.push(beefTx);
      }
      beef.atomicTxid = atomicTxid;
      return beef;
    }
    /**
     * Constructs an instance of the Beef class based on the provided binary array
     * @param bin The binary array or Uint8Array from which to construct BEEF
     * @returns An instance of the Beef class constructed from the binary data
     */
    static fromBinary(bin) {
      const br = ReaderUint8Array.makeReader(bin);
      return _Beef.fromReader(br);
    }
    /**
     * Constructs an instance of the Beef class based on the provided string
     * @param s The string value from which to construct BEEF
     * @param enc The encoding of the string value from which BEEF should be constructed
     * @returns An instance of the Beef class constructed from the string
     */
    static fromString(s2, enc = "hex") {
      const bin = toUint8Array(s2, enc);
      const br = new ReaderUint8Array(bin);
      return _Beef.fromReader(br);
    }
    /**
     * Try to validate newTx.bumpIndex by looking for an existing bump
     * that proves newTx.txid
     *
     * @param newTx A new `BeefTx` that has been added to this.txs
     * @returns true if a bump was found, false otherwise
     */
    tryToValidateBumpIndex(newTx) {
      if (newTx.bumpIndex !== void 0) {
        return true;
      }
      const txid = newTx.txid;
      for (let i = 0; i < this.bumps.length; i++) {
        const j = this.bumps[i].path[0].findIndex((b) => b.hash === txid);
        if (j >= 0) {
          newTx.bumpIndex = i;
          this.bumps[i].path[0][j].txid = true;
          return true;
        }
      }
      return false;
    }
    /**
     * Sort the `txs` by input txid dependency order:
     * - Oldest Tx Anchored by Path or txid only
     * - Newer Txs depending on Older parents
     * - Newest Tx
     *
     * with proof (MerklePath) last, longest chain of dependencies first
     *
     * @returns `{ missingInputs, notValid, valid, withMissingInputs }`
     */
    sortTxs() {
      const validTxids = {};
      const txidToTx = {};
      let queue = [];
      const result = [];
      const txidOnly = [];
      for (const tx of this.txs) {
        txidToTx[tx.txid] = tx;
        tx.isValid = tx.hasProof;
        if (tx.isValid) {
          validTxids[tx.txid] = true;
          result.push(tx);
        } else if (tx.isTxidOnly && tx.inputTxids.length === 0) {
          validTxids[tx.txid] = true;
          txidOnly.push(tx);
        } else {
          queue.push(tx);
        }
      }
      const missingInputs = {};
      const txsMissingInputs = [];
      const possiblyMissingInputs = queue;
      queue = [];
      for (const tx of possiblyMissingInputs) {
        let hasMissingInput = false;
        for (const inputTxid of tx.inputTxids) {
          if (txidToTx[inputTxid] === void 0) {
            missingInputs[inputTxid] = true;
            hasMissingInput = true;
          }
        }
        if (hasMissingInput) {
          txsMissingInputs.push(tx);
        } else {
          queue.push(tx);
        }
      }
      while (queue.length > 0) {
        const oldQueue = queue;
        queue = [];
        for (const tx of oldQueue) {
          if (tx.inputTxids.every((txid) => validTxids[txid])) {
            validTxids[tx.txid] = true;
            result.push(tx);
          } else {
            queue.push(tx);
          }
        }
        if (oldQueue.length === queue.length) {
          break;
        }
      }
      const txsNotValid = queue;
      this.txs = txsMissingInputs.concat(txsNotValid).concat(txidOnly).concat(result);
      this.needsSort = false;
      this.invalidateSerializationCaches();
      return {
        missingInputs: Object.keys(missingInputs),
        notValid: txsNotValid.map((tx) => tx.txid),
        valid: Object.keys(validTxids),
        withMissingInputs: txsMissingInputs.map((tx) => tx.txid),
        txidOnly: txidOnly.map((tx) => tx.txid)
      };
    }
    /**
     * @returns a shallow copy of this beef
     */
    clone() {
      const c = new _Beef();
      c.version = this.version;
      c.bumps = Array.from(this.bumps);
      c.txs = Array.from(this.txs);
      c.txidIndex = void 0;
      c.needsSort = this.needsSort;
      c.hexCache = this.hexCache;
      c.rawBytesCache = this.rawBytesCache;
      return c;
    }
    /**
     * Ensure that all the txids in `knownTxids` are txidOnly
     * @param knownTxids
     */
    trimKnownTxids(knownTxids) {
      let mutated = false;
      for (let i = 0; i < this.txs.length; ) {
        const tx = this.txs[i];
        if (tx.isTxidOnly && knownTxids.includes(tx.txid)) {
          this.deleteFromIndex(tx.txid);
          this.txs.splice(i, 1);
          mutated = true;
        } else {
          i++;
        }
      }
      const referencedBumpIndices = /* @__PURE__ */ new Set();
      for (const tx of this.txs) {
        if (tx.bumpIndex !== void 0) {
          referencedBumpIndices.add(tx.bumpIndex);
        }
      }
      if (referencedBumpIndices.size < this.bumps.length) {
        const indexMap = /* @__PURE__ */ new Map();
        let newIndex = 0;
        for (let i = 0; i < this.bumps.length; i++) {
          if (referencedBumpIndices.has(i)) {
            indexMap.set(i, newIndex);
            newIndex++;
          }
        }
        this.bumps = this.bumps.filter((_, i) => referencedBumpIndices.has(i));
        for (const tx of this.txs) {
          if (tx.bumpIndex !== void 0) {
            const newIndex2 = indexMap.get(tx.bumpIndex);
            if (newIndex2 === void 0) {
              throw new Error(`Internal error: bumpIndex ${tx.bumpIndex} not found in indexMap`);
            }
            tx.bumpIndex = newIndex2;
          }
        }
        mutated = true;
      }
      if (mutated) {
        this.markMutated(true);
      }
    }
    /**
     * @returns array of transaction txids that either have a proof or whose inputs chain back to a proven transaction.
     */
    getValidTxids() {
      const r2 = this.sortTxs();
      return r2.valid;
    }
    /**
     * @returns Summary of `Beef` contents as multi-line string.
     */
    toLogString() {
      let log = "";
      log += `BEEF with ${this.bumps.length} BUMPS and ${this.txs.length} Transactions, isValid ${this.isValid().toString()}
`;
      let i = -1;
      for (const b of this.bumps) {
        i++;
        log += `  BUMP ${i}
    block: ${b.blockHeight}
    txids: [
${b.path[0].filter((n) => n.txid === true).map((n) => `      '${n.hash ?? ""}'`).join(",\n")}
    ]
`;
      }
      i = -1;
      for (const t of this.txs) {
        i++;
        log += `  TX ${i}
    txid: ${t.txid}
`;
        if (t.bumpIndex !== void 0) {
          log += `    bumpIndex: ${t.bumpIndex}
`;
        }
        if (t.isTxidOnly) {
          log += "    txidOnly\n";
        } else {
          log += `    rawTx length=${t.rawTx?.length ?? 0}
`;
        }
        if (t.inputTxids.length > 0) {
          log += `    inputs: [
${t.inputTxids.map((it) => `      '${it}'`).join(",\n")}
    ]
`;
        }
      }
      return log;
    }
    /**
    * In some circumstances it may be helpful for the BUMP MerklePaths to include
    * leaves that can be computed from row zero.
    */
    addComputedLeaves() {
      const hash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      for (const bump of this.bumps) {
        for (let row = 1; row < bump.path.length; row++) {
          for (const leafL of bump.path[row - 1]) {
            if (typeof leafL.hash === "string" && (leafL.offset & 1) === 0) {
              const leafR = bump.path[row - 1].find((l) => l.offset === leafL.offset + 1);
              const offsetOnRow = leafL.offset >> 1;
              if (leafR !== void 0 && typeof leafR.hash === "string" && bump.path[row].every((l) => l.offset !== offsetOnRow)) {
                bump.path[row].push({
                  offset: offsetOnRow,
                  // String concatenation puts the right leaf on the left of the left leaf hash
                  hash: hash(leafR.hash + leafL.hash)
                });
              }
            }
          }
        }
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/Transaction.js
  var Transaction = class _Transaction {
    constructor(version = 1, inputs = [], outputs = [], lockTime = 0, metadata = /* @__PURE__ */ new Map(), merklePath) {
      __publicField(this, "version");
      __publicField(this, "inputs");
      __publicField(this, "outputs");
      __publicField(this, "lockTime");
      __publicField(this, "metadata");
      __publicField(this, "merklePath");
      __publicField(this, "cachedHash");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      this.version = version;
      this.inputs = inputs;
      this.outputs = outputs;
      this.lockTime = lockTime;
      this.metadata = metadata;
      this.merklePath = merklePath;
    }
    // Recursive function for adding merkle proofs or input transactions
    static addPathOrInputs(obj, transactions, BUMPs) {
      if (typeof obj.pathIndex === "number") {
        const path = BUMPs[obj.pathIndex];
        if (typeof path !== "object") {
          throw new Error("Invalid merkle path index found in BEEF!");
        }
        obj.tx.merklePath = path;
      } else {
        for (const input of obj.tx.inputs) {
          if (input.sourceTXID === void 0) {
            throw new Error("Input sourceTXID is undefined");
          }
          const sourceObj = transactions[input.sourceTXID];
          if (typeof sourceObj !== "object") {
            throw new Error(`Reference to unknown TXID in BEEF: ${input.sourceTXID ?? "undefined"}`);
          }
          input.sourceTransaction = sourceObj.tx;
          this.addPathOrInputs(sourceObj, transactions, BUMPs);
        }
      }
    }
    /**
     * Creates a new transaction, linked to its inputs and their associated merkle paths, from a BEEF V1, V2 or Atomic.
     * Optionally, you can provide a specific TXID to retrieve a particular transaction from the BEEF data.
     * If the TXID is provided but not found in the BEEF data, an error will be thrown.
     * If no TXID is provided, the last transaction in the BEEF data is returned, or the atomic txid.
     * @param beef A binary representation of transactions in BEEF format.
     * @param txid Optional TXID of the transaction to retrieve from the BEEF data.
     * @returns An anchored transaction, linked to its associated inputs populated with merkle paths.
     */
    static fromBEEF(beef, txid) {
      const { tx } = _Transaction.fromAnyBeef(beef, txid);
      return tx;
    }
    /**
     * Creates a new transaction from an Atomic BEEF (BRC-95) structure.
     * Extracts the subject transaction and supporting merkle path and source transactions contained in the BEEF data
     *
     * @param beef A binary representation of an Atomic BEEF structure.
     * @returns The subject transaction, linked to its associated inputs populated with merkle paths.
     */
    static fromAtomicBEEF(beef) {
      const { tx, txid, beef: b } = _Transaction.fromAnyBeef(beef);
      if (txid !== b.atomicTxid) {
        if (b.atomicTxid != null) {
          throw new Error(`Transaction with TXID ${b.atomicTxid} not found in BEEF data.`);
        } else {
          throw new Error("beef must conform to BRC-95 and must contain the subject txid.");
        }
      }
      return tx;
    }
    static fromAnyBeef(beef, txid) {
      const b = Beef.fromBinary(beef);
      if (b.txs.length < 1) {
        throw new Error("beef must include at least one transaction.");
      }
      const target = txid ?? b.atomicTxid ?? b.txs.slice(-1)[0].txid;
      const tx = b.findAtomicTransaction(target);
      if (tx == null) {
        if (txid != null) {
          throw new Error(`Transaction with TXID ${target} not found in BEEF data.`);
        } else {
          throw new Error("beef does not contain transaction for atomic txid.");
        }
      }
      return { tx, beef: b, txid: target };
    }
    /**
     * Creates a new transaction, linked to its inputs and their associated merkle paths, from a EF (BRC-30) structure.
     * @param ef A binary representation of a transaction in EF format.
     * @returns An extended transaction, linked to its associated inputs by locking script and satoshis amounts only.
     */
    static fromEF(ef) {
      const br = ReaderUint8Array.makeReader(ef);
      const version = br.readUInt32LE();
      if (toHex(br.read(6)) !== "0000000000ef") {
        throw new Error("Invalid EF marker");
      }
      const inputsLength = br.readVarIntNum();
      const inputs = [];
      for (let i = 0; i < inputsLength; i++) {
        const sourceTXID = toHex(br.readReverse(32));
        const sourceOutputIndex = br.readUInt32LE();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const unlockingScript = UnlockingScript.fromBinary(scriptBin);
        const sequence = br.readUInt32LE();
        const satoshis = br.readUInt64LEBn().toNumber();
        const lockingScriptLength = br.readVarIntNum();
        const lockingScriptBin = br.read(lockingScriptLength);
        const lockingScript = LockingScript.fromBinary(lockingScriptBin);
        const sourceTransaction = new _Transaction(void 0, [], [], void 0);
        sourceTransaction.outputs = Array(sourceOutputIndex + 1).fill(null);
        sourceTransaction.outputs[sourceOutputIndex] = {
          satoshis,
          lockingScript
        };
        inputs.push({
          sourceTransaction,
          sourceTXID,
          sourceOutputIndex,
          unlockingScript,
          sequence
        });
      }
      const outputsLength = br.readVarIntNum();
      const outputs = [];
      for (let i = 0; i < outputsLength; i++) {
        const satoshis = br.readUInt64LEBn().toNumber();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const lockingScript = LockingScript.fromBinary(scriptBin);
        outputs.push({
          satoshis,
          lockingScript
        });
      }
      const lockTime = br.readUInt32LE();
      return new _Transaction(version, inputs, outputs, lockTime);
    }
    /**
     * Since the validation of blockchain data is atomically transaction data validation,
     * any application seeking to validate data in output scripts must store the entire transaction as well.
     * Since the transaction data includes the output script data, saving a second copy of potentially
     * large scripts can bloat application storage requirements.
     *
     * This function efficiently parses binary transaction data to determine the offsets and lengths of each script.
     * This supports the efficient retreival of script data from transaction data.
     *
     * @param bin binary transaction data
     * @returns {
     *   inputs: { vin: number, offset: number, length: number }[]
     *   outputs: { vout: number, offset: number, length: number }[]
     * }
     */
    static parseScriptOffsets(bin) {
      const br = ReaderUint8Array.makeReader(bin);
      const inputs = [];
      const outputs = [];
      br.pos += 4;
      const inputsLength = br.readVarIntNum();
      for (let i = 0; i < inputsLength; i++) {
        br.pos += 36;
        const scriptLength = br.readVarIntNum();
        inputs.push({ vin: i, offset: br.pos, length: scriptLength });
        br.pos += scriptLength + 4;
      }
      const outputsLength = br.readVarIntNum();
      for (let i = 0; i < outputsLength; i++) {
        br.pos += 8;
        const scriptLength = br.readVarIntNum();
        outputs.push({ vout: i, offset: br.pos, length: scriptLength });
        br.pos += scriptLength;
      }
      return { inputs, outputs };
    }
    static fromReader(br) {
      const version = br.readUInt32LE();
      const inputsLength = br.readVarIntNum();
      const inputs = [];
      for (let i = 0; i < inputsLength; i++) {
        const sourceTXID = toHex(br.readReverse(32));
        const sourceOutputIndex = br.readUInt32LE();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const unlockingScript = UnlockingScript.fromBinary(scriptBin);
        const sequence = br.readUInt32LE();
        inputs.push({
          sourceTXID,
          sourceOutputIndex,
          unlockingScript,
          sequence
        });
      }
      const outputsLength = br.readVarIntNum();
      const outputs = [];
      for (let i = 0; i < outputsLength; i++) {
        const satoshis = br.readUInt64LEBn().toNumber();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const lockingScript = LockingScript.fromBinary(scriptBin);
        outputs.push({
          satoshis,
          lockingScript
        });
      }
      const lockTime = br.readUInt32LE();
      return new _Transaction(version, inputs, outputs, lockTime);
    }
    /**
     * Creates a Transaction instance from a binary array.
     *
     * @static
     * @param {number[]} bin - The binary array representation of the transaction.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromBinary(bin) {
      const copy = bin.slice();
      const rawBytes = Uint8Array.from(copy);
      const br = new ReaderUint8Array(rawBytes);
      const tx = _Transaction.fromReader(br);
      tx.rawBytesCache = rawBytes;
      return tx;
    }
    /**
     * Creates a Transaction instance from a hexadecimal string.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHex(hex) {
      const rawBytes = toUint8Array(hex, "hex");
      const br = new ReaderUint8Array(rawBytes);
      const tx = _Transaction.fromReader(br);
      tx.rawBytesCache = rawBytes;
      tx.hexCache = toHex(rawBytes);
      return tx;
    }
    /**
     * Creates a Transaction instance from a hexadecimal string encoded EF.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction EF.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHexEF(hex) {
      return _Transaction.fromEF(toUint8Array(hex, "hex"));
    }
    /**
     * Creates a Transaction instance from a hexadecimal string encoded BEEF.
     * Optionally, you can provide a specific TXID to retrieve a particular transaction from the BEEF data.
     * If the TXID is provided but not found in the BEEF data, an error will be thrown.
     * If no TXID is provided, the last transaction in the BEEF data is returned.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction BEEF.
     * @param {string} [txid] - Optional TXID of the transaction to retrieve from the BEEF data.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHexBEEF(hex, txid) {
      return _Transaction.fromBEEF(toArray2(hex, "hex"), txid);
    }
    invalidateSerializationCaches() {
      this.cachedHash = void 0;
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    /**
     * Adds a new input to the transaction.
     *
     * @param {TransactionInput} input - The TransactionInput object to add to the transaction.
     * @throws {Error} - If the input does not have a sourceTXID or sourceTransaction defined.
     */
    addInput(input) {
      if (typeof input.sourceTXID === "undefined" && typeof input.sourceTransaction === "undefined") {
        throw new Error("A reference to an an input transaction is required. If the input transaction itself cannot be referenced, its TXID must still be provided.");
      }
      if (typeof input.sequence === "undefined") {
        input.sequence = 4294967295;
      }
      this.invalidateSerializationCaches();
      this.inputs.push(input);
    }
    /**
     * Adds a new output to the transaction.
     *
     * @param {TransactionOutput} output - The TransactionOutput object to add to the transaction.
     */
    addOutput(output) {
      this.cachedHash = void 0;
      if (output.change !== true) {
        if (typeof output.satoshis === "undefined") {
          throw new Error("either satoshis must be defined or change must be set to true");
        }
        if (output.satoshis < 0) {
          throw new Error("satoshis must be a positive integer or zero");
        }
      }
      if (output.lockingScript == null)
        throw new Error("lockingScript must be defined");
      this.outputs.push(output);
    }
    /**
     * Adds a new P2PKH output to the transaction.
     *
     * @param {number[] | string} address - The P2PKH address of the output.
     * @param {number} [satoshis] - The number of satoshis to send to the address - if not provided, the output is considered a change output.
     *
     */
    addP2PKHOutput(address, satoshis) {
      const lockingScript = new P2PKH().lock(address);
      if (typeof satoshis === "undefined") {
        return this.addOutput({ lockingScript, change: true });
      }
      this.addOutput({
        lockingScript,
        satoshis
      });
    }
    /**
     * Updates the transaction's metadata.
     *
     * @param {Record<string, any>} metadata - The metadata object to merge into the existing metadata.
     */
    updateMetadata(metadata) {
      this.metadata = {
        ...this.metadata,
        ...metadata
      };
    }
    /**
     * Computes fees prior to signing.
     * If no fee model is provided, uses a LivePolicy fee model that fetches current rates from ARC.
     * If fee is a number, the transaction uses that value as fee.
     *
     * @param modelOrFee - The initialized fee model to use or fixed fee for the transaction
     * @param changeDistribution - Specifies how the change should be distributed
     * amongst the change outputs
     *
     */
    async fee(modelOrFee = LivePolicy.getInstance(), changeDistribution = "equal") {
      this.invalidateSerializationCaches();
      if (typeof modelOrFee === "number") {
        const sats = modelOrFee;
        modelOrFee = {
          computeFee: async () => sats
        };
      }
      const fee = await modelOrFee.computeFee(this);
      const change = this.calculateChange(fee);
      if (change <= 0) {
        this.outputs = this.outputs.filter((output) => output.change !== true);
        return;
      }
      this.distributeChange(change, changeDistribution);
    }
    calculateChange(fee) {
      let change = 0;
      for (const input of this.inputs) {
        if (typeof input.sourceTransaction !== "object") {
          throw new Error("Source transactions are required for all inputs during fee computation");
        }
        change += input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis ?? 0;
      }
      change -= fee;
      for (const out of this.outputs) {
        if (out.change !== true) {
          if (out.satoshis !== void 0) {
            change -= out.satoshis;
          }
        }
      }
      return change;
    }
    distributeChange(change, changeDistribution) {
      let distributedChange = 0;
      const changeOutputs = this.outputs.filter((out) => out.change);
      if (changeDistribution === "random") {
        distributedChange = this.distributeRandomChange(change, changeOutputs);
      } else if (changeDistribution === "equal") {
        distributedChange = this.distributeEqualChange(change, changeOutputs);
      }
      if (distributedChange < change) {
        const lastOutput = this.outputs[this.outputs.length - 1];
        if (lastOutput.satoshis !== void 0) {
          lastOutput.satoshis += change - distributedChange;
        } else {
          lastOutput.satoshis = change - distributedChange;
        }
      }
    }
    distributeRandomChange(change, changeOutputs) {
      let distributedChange = 0;
      let changeToUse = change;
      const benfordNumbers = Array(changeOutputs.length).fill(1);
      changeToUse -= changeOutputs.length;
      distributedChange += changeOutputs.length;
      for (let i = 0; i < changeOutputs.length - 1; i++) {
        const portion = this.benfordNumber(0, changeToUse);
        benfordNumbers[i] = benfordNumbers[i] + portion;
        distributedChange += portion;
        changeToUse -= portion;
      }
      for (const output of this.outputs) {
        if (output.change === true)
          output.satoshis = benfordNumbers.shift();
      }
      return distributedChange;
    }
    distributeEqualChange(change, changeOutputs) {
      let distributedChange = 0;
      const perOutput = Math.floor(change / changeOutputs.length);
      for (const out of changeOutputs) {
        distributedChange += perOutput;
        out.satoshis = perOutput;
      }
      return distributedChange;
    }
    benfordNumber(min, max) {
      const d = Math.floor(Math.random() * 9) + 1;
      return Math.floor(min + (max - min) * Math.log10(1 + 1 / d) / Math.log10(10));
    }
    /**
     * Utility method that returns the current fee based on inputs and outputs
     *
     * @returns The current transaction fee
     */
    getFee() {
      let totalIn = 0;
      for (const input of this.inputs) {
        if (typeof input.sourceTransaction !== "object") {
          throw new Error("Source transactions or sourceSatoshis are required for all inputs to calculate fee");
        }
        totalIn += input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis ?? 0;
      }
      let totalOut = 0;
      for (const output of this.outputs) {
        totalOut += output.satoshis ?? 0;
      }
      return totalIn - totalOut;
    }
    /**
     * Signs a transaction, hydrating all its unlocking scripts based on the provided script templates where they are available.
     */
    async sign() {
      this.invalidateSerializationCaches();
      for (const out of this.outputs) {
        if (typeof out.satoshis === "undefined") {
          if (out.change === true) {
            throw new Error("There are still change outputs with uncomputed amounts. Use the fee() method to compute the change amounts and transaction fees prior to signing.");
          } else {
            throw new Error("One or more transaction outputs is missing an amount. Ensure all output amounts are provided before signing.");
          }
        }
      }
      const unlockingScripts = await Promise.all(this.inputs.map(async (x, i) => {
        if (typeof this.inputs[i].unlockingScriptTemplate === "object") {
          return await this.inputs[i]?.unlockingScriptTemplate?.sign(this, i);
        } else {
          return await Promise.resolve(void 0);
        }
      }));
      for (let i = 0, l = this.inputs.length; i < l; i++) {
        if (typeof this.inputs[i].unlockingScriptTemplate === "object") {
          this.inputs[i].unlockingScript = unlockingScripts[i];
        }
      }
    }
    /**
     * Broadcasts a transaction.
     *
     * @param broadcaster The Broadcaster instance wwhere the transaction will be sent
     * @returns A BroadcastResponse or BroadcastFailure from the Broadcaster
     */
    async broadcast(broadcaster = defaultBroadcaster()) {
      return await broadcaster.broadcast(this);
    }
    writeTransactionBody(writer) {
      writer.writeUInt32LE(this.version);
      writer.writeVarIntNum(this.inputs.length);
      for (const i of this.inputs) {
        if (typeof i.sourceTXID === "undefined") {
          if (i.sourceTransaction != null) {
            writer.write(i.sourceTransaction.hash());
          } else {
            throw new Error("sourceTransaction is undefined");
          }
        } else {
          writer.writeReverse(toArray2(i.sourceTXID, "hex"));
        }
        writer.writeUInt32LE(i.sourceOutputIndex);
        if (i.unlockingScript == null) {
          throw new Error("unlockingScript is undefined");
        }
        const scriptBin = i.unlockingScript.toUint8Array();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
        writer.writeUInt32LE(i.sequence ?? 4294967295);
      }
      writer.writeVarIntNum(this.outputs.length);
      for (const o of this.outputs) {
        writer.writeUInt64LE(o.satoshis ?? 0);
        const scriptBin = o.lockingScript.toUint8Array();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
      }
      writer.writeUInt32LE(this.lockTime);
    }
    buildSerializedBytes() {
      const writer = new WriterUint8Array();
      this.writeTransactionBody(writer);
      return writer.toUint8Array();
    }
    getSerializedBytes() {
      if (this.rawBytesCache == null) {
        this.rawBytesCache = this.buildSerializedBytes();
      }
      return this.rawBytesCache;
    }
    /**
     * Converts the transaction to a binary array format.
     *
     * @returns {number[]} - The binary array representation of the transaction.
     */
    toBinary() {
      return Array.from(this.getSerializedBytes());
    }
    toUint8Array() {
      return this.getSerializedBytes();
    }
    writeEF(writer) {
      writer.writeUInt32LE(this.version);
      writer.write([0, 0, 0, 0, 0, 239]);
      writer.writeVarIntNum(this.inputs.length);
      for (const i of this.inputs) {
        if (typeof i.sourceTransaction === "undefined") {
          throw new Error("All inputs must have source transactions when serializing to EF format");
        }
        if (typeof i.sourceTXID === "undefined") {
          writer.write(i.sourceTransaction.hash());
        } else {
          writer.write(toArray2(i.sourceTXID, "hex").reverse());
        }
        writer.writeUInt32LE(i.sourceOutputIndex);
        if (i.unlockingScript == null) {
          throw new Error("unlockingScript is undefined");
        }
        const scriptBin = i.unlockingScript.toBinary();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
        writer.writeUInt32LE(i.sequence ?? 4294967295);
        writer.writeUInt64LE(i.sourceTransaction.outputs[i.sourceOutputIndex].satoshis ?? 0);
        const lockingScriptBin = i.sourceTransaction.outputs[i.sourceOutputIndex].lockingScript.toBinary();
        writer.writeVarIntNum(lockingScriptBin.length);
        writer.write(lockingScriptBin);
      }
      writer.writeVarIntNum(this.outputs.length);
      for (const o of this.outputs) {
        writer.writeUInt64LE(o.satoshis ?? 0);
        const scriptBin = o.lockingScript.toBinary();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
      }
      writer.writeUInt32LE(this.lockTime);
    }
    /**
     * Converts the transaction to a BRC-30 EF format.
     *
     * @returns {number[]} - The BRC-30 EF representation of the transaction.
     */
    toEF() {
      const writer = new Writer();
      this.writeEF(writer);
      return writer.toArray();
    }
    /**
     * Converts the transaction to a BRC-30 EF format.
     *
     * @returns {Uint8Array} - The BRC-30 EF representation of the transaction.
     */
    toEFUint8Array() {
      const writer = new WriterUint8Array();
      this.writeEF(writer);
      return writer.toUint8Array();
    }
    /**
     * Converts the transaction to a hexadecimal string EF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction EF.
     */
    toHexEF() {
      return toHex(this.toEFUint8Array());
    }
    /**
     * Converts the transaction to a hexadecimal string format.
     *
     * @returns {string} - The hexadecimal string representation of the transaction.
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      const bytes2 = this.getSerializedBytes();
      const hex = toHex(bytes2);
      this.hexCache = hex;
      return hex;
    }
    /**
     * Converts the transaction to a hexadecimal string BEEF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction BEEF.
     */
    toHexBEEF() {
      return toHex(this.toBEEF());
    }
    /**
     * Converts the transaction to a hexadecimal string Atomic BEEF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction Atomic BEEF.
     */
    toHexAtomicBEEF() {
      return toHex(this.toAtomicBEEF());
    }
    /**
     * Calculates the transaction's hash.
     *
     * @param {'hex' | undefined} enc - The encoding to use for the hash. If 'hex', returns a hexadecimal string; otherwise returns a binary array.
     * @returns {string | number[]} - The hash of the transaction in the specified format.
     */
    hash(enc) {
      if (this.cachedHash == null) {
        this.cachedHash = hash256(this.getSerializedBytes());
      }
      if (enc === "hex") {
        return toHex(this.cachedHash);
      }
      return this.cachedHash;
    }
    /**
     * Calculates the transaction's ID.
     *
     * @param {'hex' | undefined} enc - The encoding to use for the ID. If 'hex', returns a hexadecimal string; otherwise returns a binary array.
     * @returns {string | number[]} - The ID of the transaction in the specified format.
     */
    id(enc) {
      const id = [...this.hash()];
      id.reverse();
      if (enc === "hex") {
        return toHex(id);
      }
      return id;
    }
    /**
     * Verifies the legitimacy of the Bitcoin transaction according to the rules of SPV by ensuring all the input transactions link back to valid block headers, the chain of spends for all inputs are valid, and the sum of inputs is not less than the sum of outputs.
     *
     * @param chainTracker - An instance of ChainTracker, a Bitcoin block header tracker. If the value is set to 'scripts only', headers will not be verified. If not provided then the default chain tracker will be used.
     * @param feeModel - An instance of FeeModel, a fee model to use for fee calculation. If not provided then the default fee model will be used.
     * @param memoryLimit - The maximum memory in bytes usage allowed for script evaluation. If not provided then the default memory limit will be used.
     *
     * @returns Whether the transaction is valid according to the rules of SPV.
     *
     * @example tx.verify(new WhatsOnChain(), LivePolicy.getInstance())
     */
    async verify(chainTracker = defaultChainTracker(), feeModel, memoryLimit) {
      const verifiedTxids = /* @__PURE__ */ new Set();
      const txQueue = [this];
      while (txQueue.length > 0) {
        const tx = txQueue.shift();
        const txid = tx?.id("hex") ?? "";
        if (txid != null && txid !== "" && verifiedTxids.has(txid)) {
          continue;
        }
        if (typeof tx?.merklePath === "object") {
          if (chainTracker === "scripts only") {
            if (txid != null) {
              verifiedTxids.add(txid);
            }
            continue;
          } else {
            const proofValid = await tx.merklePath.verify(txid, chainTracker);
            if (proofValid) {
              verifiedTxids.add(txid);
              continue;
            } else {
              throw new Error(`Invalid merkle path for transaction ${txid}`);
            }
          }
        }
        if (typeof feeModel !== "undefined") {
          if (tx === void 0) {
            throw new Error("Transaction is undefined");
          }
          const cpTx = _Transaction.fromEF(tx.toEF());
          delete cpTx.outputs[0].satoshis;
          cpTx.outputs[0].change = true;
          await cpTx.fee(feeModel);
          if (tx.getFee() < cpTx.getFee()) {
            throw new Error(`Verification failed because the transaction ${txid} has an insufficient fee and has not been mined.`);
          }
        }
        let inputTotal = 0;
        if (tx === void 0) {
          throw new Error("Transaction is undefined");
        }
        for (let i = 0; i < tx.inputs.length; i++) {
          const input = tx.inputs[i];
          if (typeof input.sourceTransaction !== "object") {
            throw new Error(`Verification failed because the input at index ${i} of transaction ${txid} is missing an associated source transaction. This source transaction is required for transaction verification because there is no merkle proof for the transaction spending a UTXO it contains.`);
          }
          if (typeof input.unlockingScript !== "object") {
            throw new Error(`Verification failed because the input at index ${i} of transaction ${txid} is missing an associated unlocking script. This script is required for transaction verification because there is no merkle proof for the transaction spending the UTXO.`);
          }
          const sourceOutput = input.sourceTransaction.outputs[input.sourceOutputIndex];
          inputTotal += sourceOutput.satoshis ?? 0;
          const sourceTxid = input.sourceTransaction.id("hex");
          if (!verifiedTxids.has(sourceTxid)) {
            txQueue.push(input.sourceTransaction);
          }
          const otherInputs = tx.inputs.filter((_, idx) => idx !== i);
          if (typeof input.sourceTXID === "undefined") {
            input.sourceTXID = sourceTxid;
          }
          const spend = new Spend({
            sourceTXID: input.sourceTXID,
            sourceOutputIndex: input.sourceOutputIndex,
            lockingScript: sourceOutput.lockingScript,
            sourceSatoshis: sourceOutput.satoshis ?? 0,
            transactionVersion: tx.version,
            otherInputs,
            unlockingScript: input.unlockingScript,
            inputSequence: input.sequence ?? 4294967295,
            // default to max sequence
            inputIndex: i,
            outputs: tx.outputs,
            lockTime: tx.lockTime,
            memoryLimit
          });
          const spendValid = spend.validate();
          if (!spendValid) {
            return false;
          }
        }
        let outputTotal = 0;
        for (const out of tx.outputs) {
          if (typeof out.satoshis !== "number") {
            throw new Error("Every output must have a defined amount during transaction verification.");
          }
          outputTotal += out.satoshis;
        }
        if (outputTotal > inputTotal) {
          return false;
        }
        verifiedTxids.add(txid);
      }
      return true;
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    writeSerializedBEEF(writer, allowPartial) {
      writer.writeUInt32LE(BEEF_V1);
      const BUMPs = [];
      const bumpIndexByInstance = /* @__PURE__ */ new Map();
      const bumpIndexByRoot = /* @__PURE__ */ new Map();
      const txs = [];
      const seenTxids = /* @__PURE__ */ new Set();
      const getBumpIndex = (merklePath) => {
        const existingByInstance = bumpIndexByInstance.get(merklePath);
        if (existingByInstance !== void 0) {
          return existingByInstance;
        }
        const key = `${merklePath.blockHeight}:${merklePath.computeRoot()}`;
        const existingByRoot = bumpIndexByRoot.get(key);
        if (existingByRoot !== void 0) {
          BUMPs[existingByRoot].combine(merklePath);
          bumpIndexByInstance.set(merklePath, existingByRoot);
          return existingByRoot;
        }
        const newIndex = BUMPs.length;
        BUMPs.push(merklePath);
        bumpIndexByInstance.set(merklePath, newIndex);
        bumpIndexByRoot.set(key, newIndex);
        return newIndex;
      };
      const addPathsAndInputs = (tx) => {
        const txid = tx.id("hex");
        if (seenTxids.has(txid)) {
          return;
        }
        const obj = { tx };
        const merklePath = tx.merklePath;
        const hasProof = typeof merklePath === "object";
        if (hasProof && merklePath != null) {
          obj.pathIndex = getBumpIndex(merklePath);
        }
        if (!hasProof) {
          for (let i = tx.inputs.length - 1; i >= 0; i--) {
            const input = tx.inputs[i];
            if (typeof input.sourceTransaction === "object") {
              addPathsAndInputs(input.sourceTransaction);
            } else if (allowPartial === false) {
              throw new Error("A required source transaction is missing!");
            }
          }
        }
        seenTxids.add(txid);
        txs.push(obj);
      };
      addPathsAndInputs(this);
      writer.writeVarIntNum(BUMPs.length);
      for (const b of BUMPs) {
        writer.write(b.toBinary());
      }
      writer.writeVarIntNum(txs.length);
      for (const t of txs) {
        writer.write(t.tx.toBinary());
        if (typeof t.pathIndex === "number") {
          writer.writeUInt8(1);
          writer.writeVarIntNum(t.pathIndex);
        } else {
          writer.writeUInt8(0);
        }
      }
      return writer.toArray();
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toBEEF(allowPartial) {
      const writer = new Writer();
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toArray();
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toBEEFUint8Array(allowPartial) {
      const writer = new WriterUint8Array();
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toArray();
    }
    /**
     * Serializes this transaction and its inputs into the Atomic BEEF (BRC-95) format.
     * The Atomic BEEF format starts with a 4-byte prefix `0x01010101`, followed by the TXID of the subject transaction,
     * and then the BEEF data containing only the subject transaction and its dependencies.
     * This format ensures that the BEEF structure is atomic and contains no unrelated transactions.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} - The serialized Atomic BEEF structure.
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toAtomicBEEF(allowPartial) {
      const prefix = [1, 1, 1, 1];
      const txHash = this.hash();
      const beefData = this.toBEEF(allowPartial);
      return prefix.concat(txHash, beefData);
    }
    /**
     * Serializes this transaction and its inputs into the Atomic BEEF (BRC-95) format.
     * The Atomic BEEF format starts with a 4-byte prefix `0x01010101`, followed by the TXID of the subject transaction,
     * and then the BEEF data containing only the subject transaction and its dependencies.
     * This format ensures that the BEEF structure is atomic and contains no unrelated transactions.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} - The serialized Atomic BEEF structure.
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toAtomicBEEFUint8Array(allowPartial) {
      const writer = new WriterUint8Array();
      const prefix = [1, 1, 1, 1];
      writer.write(prefix);
      const txHash = this.hash();
      writer.write(txHash);
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toUint8Array();
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/compat/ECIES.js
  function AES(key) {
    if (this._tables[0][0][0] === 0)
      this._precompute();
    let tmp, encKey, decKey;
    const sbox = this._tables[0][4];
    const decTable = this._tables[1];
    const keyLen = key.length;
    let rcon = 1;
    if (keyLen !== 4 && keyLen !== 6 && keyLen !== 8) {
      throw new Error("invalid aes key size");
    }
    this._key = [encKey = key.slice(0), decKey = []];
    let i;
    for (i = keyLen; i < 4 * keyLen + 28; i++) {
      tmp = encKey[i - 1];
      if (i % keyLen === 0 || keyLen === 8 && i % keyLen === 4) {
        tmp = sbox[tmp >>> 24] << 24 ^ sbox[tmp >> 16 & 255] << 16 ^ sbox[tmp >> 8 & 255] << 8 ^ sbox[tmp & 255];
        if (i % keyLen === 0) {
          tmp = tmp << 8 ^ tmp >>> 24 ^ rcon << 24;
          rcon = rcon << 1 ^ (rcon >> 7) * 283;
        }
      }
      encKey[i] = encKey[i - keyLen] ^ tmp;
    }
    for (let j = 0; i > 0; j++, i--) {
      tmp = encKey[(j & 3) !== 0 ? i : i - 4];
      if (i <= 4 || j < 4) {
        decKey[j] = tmp;
      } else {
        decKey[j] = decTable[0][sbox[tmp >>> 24]] ^ decTable[1][sbox[tmp >> 16 & 255]] ^ decTable[2][sbox[tmp >> 8 & 255]] ^ decTable[3][sbox[tmp & 255]];
      }
    }
  }
  AES.prototype = {
    /**
     * Encrypt an array of 4 big-endian words.
     * @param {Array} data The plaintext.
     * @return {Array} The ciphertext.
     */
    encrypt: function(data) {
      return this._crypt(data, 0);
    },
    /**
     * Decrypt an array of 4 big-endian words.
     * @param {Array} data The ciphertext.
     * @return {Array} The plaintext.
     */
    decrypt: function(data) {
      return this._crypt(data, 1);
    },
    /**
     * The expanded S-box and inverse S-box tables.  These will be computed
     * on the client so that we don't have to send them down the wire.
     *
     * There are two tables, _tables[0] is for encryption and
     * _tables[1] is for decryption.
     *
     * The first 4 sub-tables are the expanded S-box with MixColumns.  The
     * last (_tables[01][4]) is the S-box itself.
     *
     * @private
     */
    _tables: [
      [
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256)
      ],
      [
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256)
      ]
    ],
    // Expand the S-box tables.
    _precompute: function() {
      const encTable = this._tables[0];
      const decTable = this._tables[1];
      const sbox = encTable[4];
      const sboxInv = decTable[4];
      let i;
      let x;
      let xInv;
      const d = new Uint8Array(256);
      const th = new Uint8Array(256);
      let x2;
      let x4;
      let x8;
      let s2;
      let tEnc;
      let tDec;
      for (i = 0; i < 256; i++) {
        th[(d[i] = i << 1 ^ (i >> 7) * 283) ^ i] = i;
      }
      for (x = xInv = 0; sbox[x] === 0; x ^= x2 !== 0 ? x2 : 1, xInv = th[xInv] !== 0 ? th[xInv] : 1) {
        s2 = xInv ^ xInv << 1 ^ xInv << 2 ^ xInv << 3 ^ xInv << 4;
        s2 = s2 >> 8 ^ s2 & 255 ^ 99;
        sbox[x] = s2;
        sboxInv[s2] = x;
        x8 = d[x4 = d[x2 = d[x]]];
        tDec = x8 * 16843009 ^ x4 * 65537 ^ x2 * 257 ^ x * 16843008;
        tEnc = d[s2] * 257 ^ s2 * 16843008;
        for (i = 0; i < 4; i++) {
          encTable[i][x] = tEnc = tEnc << 24 ^ tEnc >>> 8;
          decTable[i][s2] = tDec = tDec << 24 ^ tDec >>> 8;
        }
      }
    },
    /**
     * Encryption and decryption core.
     * @param {Array} input Four words to be encrypted or decrypted.
     * @param dir The direction, 0 for encrypt and 1 for decrypt.
     * @return {Array} The four encrypted or decrypted words.
     * @private
     */
    _crypt: function(input, dir) {
      if (input.length !== 4) {
        throw new Error("invalid aes block size");
      }
      const key = this._key[dir];
      let a = input[0] ^ key[0];
      let b = input[dir === 1 ? 3 : 1] ^ key[1];
      let c = input[2] ^ key[2];
      let d = input[dir === 1 ? 1 : 3] ^ key[3];
      let a2;
      let b2;
      let c2;
      const nInnerRounds = key.length / 4 - 2;
      let i;
      let kIndex = 4;
      const out = new Uint32Array(4);
      const table = this._tables[dir];
      const t0 = table[0];
      const t1 = table[1];
      const t2 = table[2];
      const t3 = table[3];
      const sbox = table[4];
      for (i = 0; i < nInnerRounds; i++) {
        a2 = t0[a >>> 24] ^ t1[b >> 16 & 255] ^ t2[c >> 8 & 255] ^ t3[d & 255] ^ key[kIndex];
        b2 = t0[b >>> 24] ^ t1[c >> 16 & 255] ^ t2[d >> 8 & 255] ^ t3[a & 255] ^ key[kIndex + 1];
        c2 = t0[c >>> 24] ^ t1[d >> 16 & 255] ^ t2[a >> 8 & 255] ^ t3[b & 255] ^ key[kIndex + 2];
        d = t0[d >>> 24] ^ t1[a >> 16 & 255] ^ t2[b >> 8 & 255] ^ t3[c & 255] ^ key[kIndex + 3];
        kIndex += 4;
        a = a2;
        b = b2;
        c = c2;
      }
      for (i = 0; i < 4; i++) {
        out[dir === 1 ? 3 & -i : i] = sbox[a >>> 24] << 24 ^ sbox[b >> 16 & 255] << 16 ^ sbox[c >> 8 & 255] << 8 ^ sbox[d & 255] ^ key[kIndex++];
        a2 = a;
        a = b;
        b = c;
        c = d;
        d = a2;
      }
      return out;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/wallet/Wallet.interfaces.js
  var SecurityLevels;
  (function(SecurityLevels2) {
    SecurityLevels2[SecurityLevels2["Silent"] = 0] = "Silent";
    SecurityLevels2[SecurityLevels2["App"] = 1] = "App";
    SecurityLevels2[SecurityLevels2["Counterparty"] = 2] = "Counterparty";
  })(SecurityLevels || (SecurityLevels = {}));

  // node_modules/@bsv/sdk/dist/esm/src/wallet/WalletError.js
  var walletErrors;
  (function(walletErrors2) {
    walletErrors2[walletErrors2["unknownError"] = 1] = "unknownError";
    walletErrors2[walletErrors2["unsupportedAction"] = 2] = "unsupportedAction";
    walletErrors2[walletErrors2["invalidHmac"] = 3] = "invalidHmac";
    walletErrors2[walletErrors2["invalidSignature"] = 4] = "invalidSignature";
    walletErrors2[walletErrors2["reviewActions"] = 5] = "reviewActions";
    walletErrors2[walletErrors2["invalidParameter"] = 6] = "invalidParameter";
    walletErrors2[walletErrors2["insufficientFunds"] = 7] = "insufficientFunds";
  })(walletErrors || (walletErrors = {}));

  // node_modules/@bsv/sdk/dist/esm/src/wallet/substrates/WalletWireCalls.js
  var calls;
  (function(calls2) {
    calls2[calls2["createAction"] = 1] = "createAction";
    calls2[calls2["signAction"] = 2] = "signAction";
    calls2[calls2["abortAction"] = 3] = "abortAction";
    calls2[calls2["listActions"] = 4] = "listActions";
    calls2[calls2["internalizeAction"] = 5] = "internalizeAction";
    calls2[calls2["listOutputs"] = 6] = "listOutputs";
    calls2[calls2["relinquishOutput"] = 7] = "relinquishOutput";
    calls2[calls2["getPublicKey"] = 8] = "getPublicKey";
    calls2[calls2["revealCounterpartyKeyLinkage"] = 9] = "revealCounterpartyKeyLinkage";
    calls2[calls2["revealSpecificKeyLinkage"] = 10] = "revealSpecificKeyLinkage";
    calls2[calls2["encrypt"] = 11] = "encrypt";
    calls2[calls2["decrypt"] = 12] = "decrypt";
    calls2[calls2["createHmac"] = 13] = "createHmac";
    calls2[calls2["verifyHmac"] = 14] = "verifyHmac";
    calls2[calls2["createSignature"] = 15] = "createSignature";
    calls2[calls2["verifySignature"] = 16] = "verifySignature";
    calls2[calls2["acquireCertificate"] = 17] = "acquireCertificate";
    calls2[calls2["listCertificates"] = 18] = "listCertificates";
    calls2[calls2["proveCertificate"] = 19] = "proveCertificate";
    calls2[calls2["relinquishCertificate"] = 20] = "relinquishCertificate";
    calls2[calls2["discoverByIdentityKey"] = 21] = "discoverByIdentityKey";
    calls2[calls2["discoverByAttributes"] = 22] = "discoverByAttributes";
    calls2[calls2["isAuthenticated"] = 23] = "isAuthenticated";
    calls2[calls2["waitForAuthentication"] = 24] = "waitForAuthentication";
    calls2[calls2["getHeight"] = 25] = "getHeight";
    calls2[calls2["getHeaderForHeight"] = 26] = "getHeaderForHeight";
    calls2[calls2["getNetwork"] = 27] = "getNetwork";
    calls2[calls2["getVersion"] = 28] = "getVersion";
  })(calls || (calls = {}));

  // node_modules/@bsv/sdk/dist/esm/src/auth/Peer.js
  var BufferCtor4 = typeof globalThis !== "undefined" ? globalThis.Buffer : void 0;

  // node_modules/@bsv/sdk/dist/esm/src/auth/transports/SimplifiedFetchTransport.js
  var defaultFetch = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch;

  // node_modules/@bsv/sdk/dist/esm/src/overlay-tools/HostReputationTracker.js
  var DEFAULT_LATENCY_MS = 1500;
  var LATENCY_SMOOTHING_FACTOR = 0.25;
  var BASE_BACKOFF_MS = 1e3;
  var MAX_BACKOFF_MS = 6e4;
  var FAILURE_PENALTY_MS = 400;
  var SUCCESS_BONUS_MS = 30;
  var FAILURE_BACKOFF_GRACE = 2;
  var STORAGE_KEY = "bsvsdk_overlay_host_reputation_v1";
  var HostReputationTracker = class {
    constructor(store2) {
      __publicField(this, "stats");
      __publicField(this, "store");
      this.stats = /* @__PURE__ */ new Map();
      this.store = store2 ?? this.getLocalStorageAdapter();
      this.loadFromStorage();
    }
    reset() {
      this.stats.clear();
    }
    recordSuccess(host, latencyMs) {
      const entry = this.getOrCreate(host);
      const now = Date.now();
      const safeLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : DEFAULT_LATENCY_MS;
      if (entry.avgLatencyMs === null) {
        entry.avgLatencyMs = safeLatency;
      } else {
        entry.avgLatencyMs = (1 - LATENCY_SMOOTHING_FACTOR) * entry.avgLatencyMs + LATENCY_SMOOTHING_FACTOR * safeLatency;
      }
      entry.lastLatencyMs = safeLatency;
      entry.totalSuccesses += 1;
      entry.consecutiveFailures = 0;
      entry.backoffUntil = 0;
      entry.lastUpdatedAt = now;
      entry.lastError = void 0;
      this.saveToStorage();
    }
    recordFailure(host, reason) {
      const entry = this.getOrCreate(host);
      const now = Date.now();
      entry.totalFailures += 1;
      entry.consecutiveFailures += 1;
      const msg = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : void 0;
      const immediate = typeof msg === "string" && (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND") || msg.includes("getaddrinfo") || msg.includes("Failed to fetch"));
      if (immediate && entry.consecutiveFailures < FAILURE_BACKOFF_GRACE + 1) {
        entry.consecutiveFailures = FAILURE_BACKOFF_GRACE + 1;
      }
      const penaltyLevel = Math.max(entry.consecutiveFailures - FAILURE_BACKOFF_GRACE, 0);
      if (penaltyLevel === 0) {
        entry.backoffUntil = 0;
      } else {
        const backoffDuration = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, penaltyLevel - 1));
        entry.backoffUntil = now + backoffDuration;
      }
      entry.lastUpdatedAt = now;
      entry.lastError = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : void 0;
      this.saveToStorage();
    }
    rankHosts(hosts, now = Date.now()) {
      const seen = /* @__PURE__ */ new Map();
      hosts.forEach((host, idx) => {
        if (typeof host !== "string" || host.length === 0)
          return;
        if (!seen.has(host))
          seen.set(host, idx);
      });
      const orderedHosts = Array.from(seen.keys());
      const ranked = orderedHosts.map((host) => {
        const entry = this.getOrCreate(host);
        return {
          ...entry,
          score: this.computeScore(entry, now),
          originalOrder: seen.get(host) ?? 0
        };
      });
      ranked.sort((a, b) => {
        const aInBackoff = a.backoffUntil > now;
        const bInBackoff = b.backoffUntil > now;
        if (aInBackoff !== bInBackoff)
          return aInBackoff ? 1 : -1;
        if (a.score !== b.score)
          return a.score - b.score;
        if (a.totalSuccesses !== b.totalSuccesses)
          return b.totalSuccesses - a.totalSuccesses;
        return a.originalOrder - b.originalOrder;
      });
      return ranked.map(({ originalOrder, ...rest }) => rest);
    }
    snapshot(host) {
      const entry = this.stats.get(host);
      return entry != null ? { ...entry } : void 0;
    }
    getStorage() {
      try {
        const g = typeof globalThis === "object" ? globalThis : void 0;
        if (g == null || g.localStorage == null)
          return void 0;
        return g.localStorage;
      } catch {
        return void 0;
      }
    }
    getLocalStorageAdapter() {
      const s2 = this.getStorage();
      if (s2 == null)
        return void 0;
      return {
        get: (key) => {
          try {
            return s2.getItem(key);
          } catch {
            return null;
          }
        },
        set: (key, value) => {
          try {
            s2.setItem(key, value);
          } catch {
          }
        }
      };
    }
    loadFromStorage() {
      const s2 = this.store;
      if (s2 == null)
        return;
      try {
        const raw = s2.get(STORAGE_KEY);
        if (typeof raw !== "string" || raw.length === 0)
          return;
        const data = JSON.parse(raw);
        if (typeof data !== "object" || data === null)
          return;
        this.stats.clear();
        for (const k of Object.keys(data)) {
          const v = data[k];
          if (v != null && typeof v === "object") {
            const entry = {
              host: String(v.host ?? k),
              totalSuccesses: Number(v.totalSuccesses ?? 0),
              totalFailures: Number(v.totalFailures ?? 0),
              consecutiveFailures: Number(v.consecutiveFailures ?? 0),
              avgLatencyMs: v.avgLatencyMs == null ? null : Number(v.avgLatencyMs),
              lastLatencyMs: v.lastLatencyMs == null ? null : Number(v.lastLatencyMs),
              backoffUntil: Number(v.backoffUntil ?? 0),
              lastUpdatedAt: Number(v.lastUpdatedAt ?? 0),
              lastError: typeof v.lastError === "string" ? v.lastError : void 0
            };
            this.stats.set(entry.host, entry);
          }
        }
      } catch {
      }
    }
    saveToStorage() {
      const s2 = this.store;
      if (s2 == null)
        return;
      try {
        const obj = {};
        for (const [host, entry] of this.stats.entries()) {
          obj[host] = entry;
        }
        s2.set(STORAGE_KEY, JSON.stringify(obj));
      } catch {
      }
    }
    computeScore(entry, now) {
      const latency = entry.avgLatencyMs ?? DEFAULT_LATENCY_MS;
      const failurePenalty = entry.consecutiveFailures * FAILURE_PENALTY_MS;
      const successBonus = Math.min(entry.totalSuccesses * SUCCESS_BONUS_MS, latency / 2);
      const backoffPenalty = entry.backoffUntil > now ? entry.backoffUntil - now : 0;
      return latency + failurePenalty + backoffPenalty - successBonus;
    }
    getOrCreate(host) {
      let entry = this.stats.get(host);
      if (entry == null) {
        entry = {
          host,
          totalSuccesses: 0,
          totalFailures: 0,
          consecutiveFailures: 0,
          avgLatencyMs: null,
          lastLatencyMs: null,
          backoffUntil: 0,
          lastUpdatedAt: 0
        };
        this.stats.set(host, entry);
      }
      return entry;
    }
  };
  var globalTracker = new HostReputationTracker();

  // node_modules/@bsv/sdk/dist/esm/src/overlay-tools/LookupResolver.js
  var defaultFetch2 = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch;

  // src/token_protocol/walletProvider.ts
  var WOC_BASE = typeof location !== "undefined" && location.hostname === "localhost" ? "/woc/v1/bsv/main" : "https://api.whatsonchain.com/v1/bsv/main";
  var MIN_REQUEST_DELAY = 600;
  var fetchQueue = Promise.resolve();
  function queuedFetch(url, init2) {
    return new Promise((resolve, reject) => {
      fetchQueue = fetchQueue.then(async () => {
        try {
          const resp = await fetch(url, init2);
          resolve(resp);
        } catch (err) {
          reject(err);
        }
        await new Promise((r2) => setTimeout(r2, MIN_REQUEST_DELAY));
      });
    });
  }
  var WalletProvider = class {
    // key: "txId:outputIndex"
    constructor(address) {
      __publicField(this, "address");
      __publicField(this, "txCache", /* @__PURE__ */ new Map());
      /**
       * v05.22: Local pending UTXO tracking for consecutive transfers.
       *
       * When we broadcast a TX, the change output won't appear in WoC's UTXO list
       * until the TX is confirmed. This prevents consecutive fragment transfers
       * because the second transfer can't find funding UTXOs.
       *
       * Solution: Track pending UTXOs locally and combine with confirmed UTXOs.
       */
      __publicField(this, "pendingUtxos", /* @__PURE__ */ new Map());
      // key: "txId:outputIndex"
      __publicField(this, "spentOutpoints", /* @__PURE__ */ new Set());
      this.address = address;
    }
    getAddress() {
      return this.address;
    }
    // ── Wallet Operations (UTXO model) ─────────────────────────────
    /**
     * Get UTXOs combining confirmed (from WoC) with local pending UTXOs.
     *
     * v05.22: Enables consecutive transfers by including unconfirmed change
     * outputs and excluding locally-spent outpoints.
     */
    async getUtxos() {
      const address = this.getAddress();
      const resp = await queuedFetch(`${WOC_BASE}/address/${address}/unspent`);
      if (!resp.ok) throw new Error(`WoC UTXO fetch failed: ${resp.status}`);
      const data = await resp.json();
      const confirmed = Array.isArray(data) ? data.map((u) => ({
        txId: u.tx_hash,
        outputIndex: u.tx_pos,
        satoshis: u.value,
        script: ""
      })) : [];
      const filtered = confirmed.filter((u) => {
        const key = `${u.txId}:${u.outputIndex}`;
        return !this.spentOutpoints.has(key);
      });
      for (const u of confirmed) {
        const key = `${u.txId}:${u.outputIndex}`;
        if (this.pendingUtxos.has(key)) {
          this.pendingUtxos.delete(key);
          console.debug(`getUtxos: Pending UTXO ${key.slice(0, 16)}... now confirmed`);
        }
      }
      const pending = Array.from(this.pendingUtxos.values());
      const combined = [...filtered, ...pending];
      console.debug(`getUtxos: ${confirmed.length} confirmed, ${this.spentOutpoints.size} spent locally, ${pending.length} pending = ${combined.length} available`);
      return combined;
    }
    /**
     * Register a pending transaction for local UTXO tracking.
     *
     * Call this after broadcasting a TX to enable consecutive transfers
     * before the TX is confirmed.
     *
     * @param txId - The broadcast transaction ID
     * @param spentInputs - Outpoints consumed by this TX [{txId, outputIndex}]
     * @param changeOutput - Change output created by this TX (if any)
     */
    registerPendingTx(txId, spentInputs, changeOutput) {
      for (const input of spentInputs) {
        const key = `${input.txId}:${input.outputIndex}`;
        this.spentOutpoints.add(key);
        this.pendingUtxos.delete(key);
      }
      if (changeOutput && changeOutput.satoshis > 0) {
        const key = `${txId}:${changeOutput.outputIndex}`;
        this.pendingUtxos.set(key, {
          txId,
          outputIndex: changeOutput.outputIndex,
          satoshis: changeOutput.satoshis,
          script: ""
        });
        console.debug(`registerPendingTx: Added pending UTXO ${key.slice(0, 16)}... (${changeOutput.satoshis} sats)`);
      }
      console.debug(`registerPendingTx: TX ${txId.slice(0, 12)}... spent ${spentInputs.length} inputs, pending UTXOs: ${this.pendingUtxos.size}`);
    }
    /**
     * Clear spent outpoints for a confirmed transaction.
     *
     * Call this when a pending TX is confirmed to clean up tracking state.
     * Note: Pending UTXOs are auto-cleaned in getUtxos() when they appear confirmed.
     */
    clearConfirmedSpends(spentInputs) {
      for (const input of spentInputs) {
        const key = `${input.txId}:${input.outputIndex}`;
        this.spentOutpoints.delete(key);
      }
    }
    async getBalance() {
      const utxos = await this.getUtxos();
      return utxos.reduce((sum, u) => sum + u.satoshis, 0);
    }
    // ── Broadcasting ──────────────────────────────────────────────
    async broadcast(rawHex) {
      const resp = await queuedFetch(`${WOC_BASE}/tx/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txhex: rawHex })
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Broadcast failed (${resp.status}): ${text}`);
      }
      const txId = await resp.text();
      return txId.replace(/"/g, "");
    }
    // ── Raw Transactions ──────────────────────────────────────────
    async getRawTransaction(txId) {
      const cached = this.txCache.get(txId);
      if (cached) return cached;
      const resp = await queuedFetch(`${WOC_BASE}/tx/${txId}/hex`);
      if (!resp.ok) throw new Error(`WoC raw TX fetch failed: ${resp.status}`);
      const hex = await resp.text();
      this.txCache.set(txId, hex);
      return hex;
    }
    async getSourceTransaction(txId) {
      const hex = await this.getRawTransaction(txId);
      return Transaction.fromHex(hex);
    }
    // ── Block Headers (feeds into SPV verification) ───────────────
    async getBlockHeader(height) {
      const hashResp = await queuedFetch(`${WOC_BASE}/block/height/${height}`);
      if (!hashResp.ok) throw new Error(`WoC block height fetch failed: ${hashResp.status}`);
      const hashBody = await hashResp.text();
      let blockHash;
      try {
        const parsed = JSON.parse(hashBody);
        blockHash = typeof parsed === "string" ? parsed : parsed.hash;
      } catch {
        blockHash = hashBody.replace(/"/g, "");
      }
      try {
        const parsed = JSON.parse(hashBody);
        if (typeof parsed === "object" && parsed.merkleroot) {
          return {
            height,
            merkleRoot: parsed.merkleroot,
            hash: parsed.hash,
            timestamp: parsed.time,
            prevHash: parsed.previousblockhash
          };
        }
      } catch {
      }
      const headerResp = await queuedFetch(`${WOC_BASE}/block/${blockHash}/header`);
      if (!headerResp.ok) throw new Error(`WoC block header fetch failed: ${headerResp.status}`);
      const hdr = await headerResp.json();
      return {
        height,
        merkleRoot: hdr.merkleroot,
        hash: hdr.hash,
        timestamp: hdr.time,
        prevHash: hdr.previousblockhash
      };
    }
    // ── Address History ───────────────────────────────────────────
    async getAddressHistory() {
      const address = this.getAddress();
      const resp = await queuedFetch(`${WOC_BASE}/address/${address}/history`);
      if (!resp.ok) throw new Error(`WoC history fetch failed: ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) return [];
      return data.map((entry) => ({
        txId: entry.tx_hash,
        blockHeight: entry.height ?? 0
      }));
    }
    // ── Merkle Proofs (feeds into proof chain construction) ───────
    async getMerkleProof(txId) {
      const resp = await queuedFetch(`${WOC_BASE}/tx/${txId}/proof/tsc`);
      if (!resp.ok) {
        console.debug(`getMerkleProof: WoC returned ${resp.status} for ${txId.slice(0, 12)}...`);
        return null;
      }
      const raw = await resp.json();
      console.debug("getMerkleProof: raw response:", JSON.stringify(raw).slice(0, 200));
      const data = Array.isArray(raw) ? raw[0] : raw;
      if (!data || !data.target) {
        console.debug("getMerkleProof: no target in proof data:", data);
        return null;
      }
      const nodes = data.nodes ?? [];
      const index = data.index ?? 0;
      const path = [];
      let idx = index;
      for (const node of nodes) {
        if (node === "*") {
          idx = idx >> 1;
          continue;
        }
        const position = idx % 2 === 0 ? "R" : "L";
        path.push({ hash: node, position });
        idx = idx >> 1;
      }
      const blockHash = data.target;
      const headerResp = await queuedFetch(`${WOC_BASE}/block/${blockHash}/header`);
      if (!headerResp.ok) return null;
      const header = await headerResp.json();
      return {
        txId,
        blockHeight: header.height,
        merkleRoot: header.merkleroot,
        path
      };
    }
  };

  // src/token_protocol/tokenProtocol.ts
  function hexToBytes(hex) {
    const bytes2 = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes2.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes2;
  }
  function bytesToHex2(bytes2) {
    return bytes2.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function uint32LE(n) {
    return [n & 255, n >> 8 & 255, n >> 16 & 255, n >> 24 & 255];
  }
  function doubleSha256(data) {
    return Hash_exports.sha256(Hash_exports.sha256(data));
  }
  function sha2562(data) {
    return Hash_exports.sha256(data);
  }
  function computeTokenId(genesisTxId, outputIndex, immutableChunkBytes) {
    const txIdBytes = hexToBytes(genesisTxId);
    const indexBytes = uint32LE(outputIndex);
    const hash = sha2562([...txIdBytes, ...indexBytes, ...immutableChunkBytes]);
    return bytesToHex2(hash);
  }
  function computeFungibleTokenId(genesisTxId, immutableChunkBytes) {
    return computeTokenId(genesisTxId, 1, immutableChunkBytes);
  }
  function verifyMerkleProof(entry) {
    let current = hexToBytes(entry.txId).reverse();
    for (const node of entry.path) {
      const sibling = hexToBytes(node.hash).reverse();
      const combined = node.position === "R" ? [...current, ...sibling] : [...sibling, ...current];
      current = doubleSha256(combined);
    }
    const computedRoot = bytesToHex2(current.reverse());
    return computedRoot === entry.merkleRoot;
  }
  function verifyProofChain(chain, headers) {
    if (chain.entries.length === 0) {
      return { valid: false, reason: "Proof chain is empty" };
    }
    for (const entry of chain.entries) {
      if (!verifyMerkleProof(entry)) {
        return {
          valid: false,
          reason: `Merkle proof invalid for TX ${entry.txId.slice(0, 12)}...`
        };
      }
      const header = headers.get(entry.blockHeight);
      if (!header) {
        return {
          valid: false,
          reason: `No block header for height ${entry.blockHeight}`
        };
      }
      if (header.merkleRoot !== entry.merkleRoot) {
        return {
          valid: false,
          reason: `Merkle root mismatch at height ${entry.blockHeight}`
        };
      }
    }
    const oldest = chain.entries[chain.entries.length - 1];
    if (oldest.txId !== chain.genesisTxId) {
      return {
        valid: false,
        reason: "Oldest proof entry does not match genesis TX"
      };
    }
    return { valid: true, reason: "Token is valid with verified proof chain" };
  }
  async function verifyProofChainAsync(chain, getBlockHeader) {
    if (chain.entries.length === 0) {
      return { valid: false, reason: "Proof chain is empty" };
    }
    const heights = [...new Set(chain.entries.map((e) => e.blockHeight))];
    const headers = /* @__PURE__ */ new Map();
    for (const h of heights) {
      try {
        headers.set(h, await getBlockHeader(h));
      } catch (e) {
        const detail = e?.message ? `: ${e.message}` : "";
        return { valid: false, reason: `Failed to fetch header at height ${h}${detail}` };
      }
    }
    return verifyProofChain(chain, headers);
  }
  function createProofChain(genesisTxId, genesisProof) {
    return { genesisTxId, entries: [genesisProof] };
  }
  function extendProofChain(chain, newEntry) {
    return {
      genesisTxId: chain.genesisTxId,
      entries: [newEntry, ...chain.entries]
    };
  }

  // src/token_protocol/opReturnCodec.ts
  var P_PREFIX = [80];
  var P_VERSION = 3;
  function hexToBytes2(hex) {
    if (hex.length === 0) return [];
    const bytes2 = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes2.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes2;
  }
  function bytesToHex3(bytes2) {
    return bytes2.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function stringToBytes(str) {
    return Array.from(new TextEncoder().encode(str));
  }
  function bytesToString(bytes2) {
    return new TextDecoder().decode(new Uint8Array(bytes2));
  }
  function pushData(data) {
    const len = data.length;
    let op;
    if (len > 0 && len < OP_default.OP_PUSHDATA1) {
      op = len;
    } else if (len < 256) {
      op = OP_default.OP_PUSHDATA1;
    } else if (len < 65536) {
      op = OP_default.OP_PUSHDATA2;
    } else {
      op = OP_default.OP_PUSHDATA4;
    }
    return { op, data };
  }
  function uint32LE2(n) {
    return [n & 255, n >> 8 & 255, n >> 16 & 255, n >> 24 & 255];
  }
  function readUint32LE(bytes2, offset) {
    return (bytes2[offset] | bytes2[offset + 1] << 8 | bytes2[offset + 2] << 16 | bytes2[offset + 3] << 24) >>> 0;
  }
  function encodeProofChainBinary(entries) {
    const buf = [];
    for (const entry of entries) {
      buf.push(...hexToBytes2(entry.txId));
      buf.push(...uint32LE2(entry.blockHeight));
      buf.push(...hexToBytes2(entry.merkleRoot));
      buf.push(entry.path.length & 255);
      for (const node of entry.path) {
        buf.push(...hexToBytes2(node.hash));
        buf.push(node.position === "L" ? 0 : 1);
      }
    }
    return buf;
  }
  function decodeProofChainBinary(bytes2) {
    if (bytes2.length === 0) return [];
    const entries = [];
    let offset = 0;
    while (offset < bytes2.length) {
      const txId = bytesToHex3(bytes2.slice(offset, offset + 32));
      offset += 32;
      const blockHeight = readUint32LE(bytes2, offset);
      offset += 4;
      const merkleRoot = bytesToHex3(bytes2.slice(offset, offset + 32));
      offset += 32;
      const nodeCount = bytes2[offset++];
      const path = [];
      for (let j = 0; j < nodeCount; j++) {
        const hash = bytesToHex3(bytes2.slice(offset, offset + 32));
        offset += 32;
        const position = bytes2[offset++] === 0 ? "L" : "R";
        path.push({ hash, position });
      }
      entries.push({ txId, blockHeight, merkleRoot, path });
    }
    return entries;
  }
  function encodeOpReturn(data) {
    const nameBytes = stringToBytes(data.tokenName);
    const scriptBytes = hexToBytes2(data.tokenScript);
    const rulesBytes = hexToBytes2(data.tokenRules);
    const attrsBytes = hexToBytes2(data.tokenAttributes);
    const stateBytes = data.stateData ? hexToBytes2(data.stateData) : [0];
    const chunks = [
      { op: OP_default.OP_0 },
      { op: OP_default.OP_RETURN },
      // Indices below are in the encoder's LockingScript array (includes OP_0, OP_RETURN at [0],[1])
      // After parsePushdataChunks, data chunks shift down (OP_0, OP_RETURN skipped): [2]→[0], [3]→[1], etc.
      pushData(P_PREFIX),
      // [2] in encoder → [0] in parser: "P"
      pushData([P_VERSION]),
      // [3] in encoder → [1] in parser: version (0x03)
      pushData(nameBytes),
      // [4] in encoder → [2] in parser: tokenName
      pushData(scriptBytes.length > 0 ? scriptBytes : []),
      // [5] in encoder → [3] in parser: tokenScript (consensus)
      pushData(rulesBytes),
      // [6] in encoder → [4] in parser: tokenRules (application)
      pushData(attrsBytes.length > 0 ? attrsBytes : []),
      // [7] in encoder → [5] in parser: tokenAttributes (user)
      pushData(stateBytes.length > 0 ? stateBytes : [0])
      // [8] in encoder → [6] in parser: stateData (mutable)
    ];
    if (data.genesisTxId) {
      console.debug(`encodeOpReturn: Adding transfer TX fields. genesisTxId=${data.genesisTxId.substring(0, 12)}..., chunks before=${chunks.length}`);
      chunks.push(pushData(hexToBytes2(data.genesisTxId)));
      chunks.push(pushData(encodeProofChainBinary(data.proofChainEntries ?? [])));
      console.debug(`encodeOpReturn: Transfer TX fields added. chunks after=${chunks.length}`);
    }
    return new LockingScript(chunks);
  }
  function parsePushdataChunks(bytes2, offset) {
    const chunks = [];
    const startOffset = offset;
    while (offset < bytes2.length) {
      const op = bytes2[offset++];
      if (op === 0) {
        chunks.push([]);
      } else if (op >= 1 && op <= 75) {
        chunks.push(bytes2.slice(offset, offset + op));
        offset += op;
      } else if (op === 76) {
        const len = bytes2[offset++];
        chunks.push(bytes2.slice(offset, offset + len));
        offset += len;
      } else if (op === 77) {
        const len = bytes2[offset] | bytes2[offset + 1] << 8;
        offset += 2;
        chunks.push(bytes2.slice(offset, offset + len));
        offset += len;
      } else if (op === 78) {
        const len = bytes2[offset] | bytes2[offset + 1] << 8 | bytes2[offset + 2] << 16 | bytes2[offset + 3] << 24;
        offset += 4;
        chunks.push(bytes2.slice(offset, offset + len));
        offset += len;
      } else {
        console.debug(`parsePushdataChunks: stopped at offset ${offset - 1}, unknown op 0x${op.toString(16)}, parsed ${chunks.length} chunks, total bytes parsed ${offset - startOffset}`);
        break;
      }
    }
    return chunks;
  }
  function decodeOpReturn(script) {
    const raw = script.toBinary();
    if (raw.length < 4) return null;
    if (raw[0] !== 0 || raw[1] !== 106) return null;
    const chunks = parsePushdataChunks(raw, 2);
    if (raw.length > 100) {
      const hexStart = Array.from(raw.slice(0, Math.min(80, raw.length))).map((b) => b.toString(16).padStart(2, "0")).join("");
      console.debug(`decodeOpReturn: found ${chunks.length} chunks, raw script length ${raw.length} bytes, hex start: ${hexStart}...`);
    }
    if (chunks.length < 7) return null;
    const prefix = chunks[0];
    if (prefix.length !== 1 || prefix[0] !== 80) {
      return null;
    }
    const versionData = chunks[1];
    if (versionData.length !== 1 || versionData[0] !== P_VERSION) return null;
    const tokenName = bytesToString(chunks[2]);
    const tokenScript = bytesToHex3(chunks[3]);
    const tokenRules = bytesToHex3(chunks[4]);
    const tokenAttributes = bytesToHex3(chunks[5]);
    const stateData = bytesToHex3(chunks[6]);
    const result = {
      tokenName,
      tokenScript,
      tokenRules,
      tokenAttributes,
      stateData
    };
    if (chunks.length >= 9) {
      result.genesisTxId = bytesToHex3(chunks[7]);
      result.proofChainEntries = decodeProofChainBinary(chunks[8]);
    }
    return result;
  }
  function buildImmutableChunkBytes(tokenName, tokenScript, tokenRules) {
    const nameBytes = stringToBytes(tokenName);
    const scriptBytes = hexToBytes2(tokenScript);
    const rulesBytes = hexToBytes2(tokenRules);
    return [...nameBytes, ...scriptBytes, ...rulesBytes];
  }
  var P_FILE_MARKER = [80, 45, 70, 73, 76, 69];
  function buildFileOpReturn(file) {
    const chunks = [
      { op: OP_default.OP_0 },
      { op: OP_default.OP_RETURN },
      pushData(P_FILE_MARKER),
      pushData(stringToBytes(file.mimeType)),
      pushData(stringToBytes(file.fileName)),
      pushData(Array.from(file.bytes))
    ];
    return new LockingScript(chunks);
  }
  function parseFileOpReturn(script) {
    const raw = script.toBinary();
    if (raw.length < 4 || raw[0] !== 0 || raw[1] !== 106) return null;
    const chunks = parsePushdataChunks(raw, 2);
    if (chunks.length < 4) return null;
    const marker = chunks[0];
    if (marker.length !== 6 || bytesToString(marker) !== "P-FILE") return null;
    return {
      mimeType: bytesToString(chunks[1]),
      fileName: bytesToString(chunks[2]),
      bytes: new Uint8Array(chunks[3])
    };
  }
  var RESTRICTION_FUNGIBLE = 1;
  function encodeTokenRules(supply, divisibility, restrictions, version) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint16(0, supply, true);
    view.setUint16(2, divisibility, true);
    view.setUint16(4, restrictions, true);
    view.setUint16(6, version, true);
    return bytesToHex3(Array.from(new Uint8Array(buf)));
  }
  function decodeTokenRules(rulesHex) {
    const bytes2 = hexToBytes2(rulesHex);
    const view = new DataView(new Uint8Array(bytes2).buffer);
    const restrictions = view.getUint16(4, true);
    return {
      supply: view.getUint16(0, true),
      divisibility: view.getUint16(2, true),
      restrictions,
      version: view.getUint16(6, true),
      isFungible: (restrictions & RESTRICTION_FUNGIBLE) !== 0
    };
  }

  // src/token_protocol/tokenBuilder.ts
  var TOKEN_SATS = 1;
  var DEFAULT_FEE_PER_KB = 100;
  var BYTES_PER_INPUT = 148;
  var BYTES_PER_P2PKH_OUTPUT = 34;
  var TX_OVERHEAD = 10;
  var TokenBuilder = class {
    constructor(provider2, store2, key) {
      this.provider = provider2;
      this.store = store2;
      __publicField(this, "feePerKb", DEFAULT_FEE_PER_KB);
      __publicField(this, "key");
      __publicField(this, "myAddress");
      this.key = key;
      this.myAddress = key.toAddress();
    }
    // ── Token UTXO Protection ───────────────────────────────────────
    /**
     * Build a set of "txId:outputIndex" keys for UTXOs currently holding
     * active or pending tokens. These must never be used as funding inputs.
     */
    async getTokenUtxoKeys() {
      const tokens = await this.store.listTokens();
      const keys = /* @__PURE__ */ new Set();
      for (const t of tokens) {
        if (t.status === "active" || t.status === "pending_transfer") {
          keys.add(`${t.currentTxId}:${t.currentOutputIndex}`);
        }
      }
      return keys;
    }
    /**
     * Return only UTXOs that are safe to spend as funding inputs.
     *
     * ALL 1-sat UTXOs are permanently quarantined -- never spent as
     * funding inputs. A 1-sat UTXO is almost certainly a token of
     * some kind (P, Ordinal, 1Sat Ordinals, etc.) and destroying
     * it by using it as a funding input is irreversible.
     *
     * The only code path that spends a 1-sat UTXO is createTransfer(),
     * which explicitly spends it as Input 0 when the user chooses to
     * transfer a specific known token.
     *
     * For any quarantined 1-sat UTXOs that contain P OP_RETURN data
     * addressed to this wallet, we auto-import them into the token store.
     */
    async getSafeUtxos() {
      const utxos = await this.provider.getUtxos();
      const safe = [];
      for (const u of utxos) {
        if (u.satoshis <= TOKEN_SATS) {
          this.tryAutoImport(u).catch(() => {
          });
          continue;
        }
        safe.push(u);
      }
      return safe;
    }
    /**
     * Get spendable balance (excludes sats locked in token UTXOs).
     *
     * This returns the balance available for spending, excluding any
     * 1-sat UTXOs that are reserved for token ownership.
     */
    async getSpendableBalance() {
      const safeUtxos = await this.getSafeUtxos();
      return safeUtxos.reduce((sum, u) => sum + u.satoshis, 0);
    }
    /**
     * SPV verification gate for token import.
     *
     * Checks Token ID derivation, then verifies the genesis TX's Merkle
     * proof against its block header. Only the genesis entry is checked —
     * transfer TXs are already validated by miners when spent.
     *
     * If no proof chain entries are available (e.g. genesis TX with no
     * on-chain bundle), fetches the Merkle proof for currentTxId on demand.
     */
    async verifyBeforeImport(tokenId, genesisTxId, genesisOutputIndex, immutableBytes, proofChainEntries, currentTxId) {
      const expectedId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes);
      if (expectedId !== tokenId) {
        return { valid: false, chain: { genesisTxId, entries: [] }, reason: "Token ID does not match genesis" };
      }
      let entries = proofChainEntries;
      if (entries.length === 0) {
        try {
          const currentTx = await this.provider.getSourceTransaction(currentTxId);
          if (!currentTx.inputs || currentTx.inputs.length === 0) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: "Unconfirmed TX has no inputs" };
          }
          const input0 = currentTx.inputs[0];
          const ancestorTxId = input0.sourceTXID;
          if (!ancestorTxId) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: "Cannot trace ancestor transaction" };
          }
          const ancestorProof = await this.provider.getMerkleProof(ancestorTxId);
          if (!ancestorProof) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: "No Merkle proof for ancestor transaction" };
          }
          if (!verifyMerkleProof(ancestorProof)) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: "Invalid Merkle proof for ancestor transaction" };
          }
          let genesisBlockHeight = null;
          const existingToken = await this.store.getToken(tokenId);
          if (existingToken?.blockHeight && existingToken.blockHeight > 0) {
            genesisBlockHeight = existingToken.blockHeight;
            console.debug(`verifyBeforeImport: Using blockHeight=${genesisBlockHeight} from existing token record`);
          } else {
            const genesisProof = await this.provider.getMerkleProof(genesisTxId);
            if (genesisProof) {
              genesisBlockHeight = genesisProof.blockHeight;
              console.debug(`verifyBeforeImport: Using blockHeight=${genesisBlockHeight} from genesis proof`);
            }
          }
          if (genesisBlockHeight === null || genesisBlockHeight === 0) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: "Cannot determine genesis block height" };
          }
          try {
            const header = await this.provider.getBlockHeader(genesisBlockHeight);
            console.debug(`verifyBeforeImport: Verified genesis block header at height ${genesisBlockHeight}`);
          } catch (e) {
            return { valid: false, chain: { genesisTxId, entries: [] }, reason: `Failed to fetch genesis block header: ${e?.message}` };
          }
          console.debug(`verifyBeforeImport: Unconfirmed token verified via ancestor proof (txId=${currentTxId.slice(0, 12)}...)`);
          return { valid: true, chain: { genesisTxId, entries: [] }, reason: "Verified via ancestor proof and genesis block header" };
        } catch (e) {
          console.debug(`verifyBeforeImport: Error verifying unconfirmed token: ${e?.message}`);
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: `Unconfirmed token verification failed: ${e?.message}` };
        }
      }
      const chain = { genesisTxId, entries };
      const genesisEntry = entries[entries.length - 1];
      if (genesisEntry.txId !== genesisTxId) {
        return { valid: false, chain, reason: "Oldest proof entry does not match genesis TX" };
      }
      if (!verifyMerkleProof(genesisEntry)) {
        return { valid: false, chain, reason: `Merkle proof invalid for genesis TX ${genesisTxId.slice(0, 12)}...` };
      }
      try {
        const header = await this.provider.getBlockHeader(genesisEntry.blockHeight);
        if (header.merkleRoot !== genesisEntry.merkleRoot) {
          return { valid: false, chain, reason: `Merkle root mismatch at height ${genesisEntry.blockHeight}` };
        }
      } catch (e) {
        const detail = e?.message ? `: ${e.message}` : "";
        return { valid: false, chain, reason: `Failed to fetch block header at height ${genesisEntry.blockHeight}${detail}` };
      }
      return { valid: true, chain };
    }
    /**
     * Derive genesisOutputIndex from a transfer TX we already have.
     *
     * v05.21: genesisOutputIndex is no longer encoded in the OP_RETURN. Instead,
     * we read Input 0 of the transfer TX to find which output it spent.
     *
     * For direct transfers (genesis → recipient): Input 0 points directly to
     * the genesis TX, and sourceOutputIndex IS the genesisOutputIndex.
     *
     * For multi-hop transfers (genesis → A → B → ...): We trace Input 0 backwards
     * through each TX until we reach the genesis TX.
     *
     * @param transferTx   The transfer TX object (already fetched)
     * @param genesisTxId  The genesis TX ID (from OP_RETURN)
     * @returns The output index in the genesis TX, or null if chain traversal fails
     */
    async deriveGenesisOutputIndex(transferTx, genesisTxId) {
      if (!transferTx.inputs || transferTx.inputs.length === 0) {
        console.debug(`deriveGenesisOutputIndex: TX has no inputs`);
        return null;
      }
      const input0 = transferTx.inputs[0];
      const prevTxId = input0.sourceTXID;
      const prevOutputIndex = input0.sourceOutputIndex;
      console.debug(`deriveGenesisOutputIndex: genesisTxId=${genesisTxId.slice(0, 12)}..., input0 keys=${Object.keys(input0).join(",")}`);
      console.debug(`deriveGenesisOutputIndex: input0.sourceTXID=${prevTxId?.slice(0, 12)}, input0.sourceOutputIndex=${prevOutputIndex}`);
      console.debug(`deriveGenesisOutputIndex: input0 object=${JSON.stringify(input0, (k, v) => typeof v === "object" && v !== null ? "[Object]" : v, 2)}`);
      if (!prevTxId) {
        console.debug(`deriveGenesisOutputIndex: Input 0 has no sourceTXID`);
        return null;
      }
      if (prevTxId === genesisTxId) {
        console.debug(`deriveGenesisOutputIndex: Direct transfer, genesis output index = ${prevOutputIndex}`);
        return prevOutputIndex;
      }
      let txId = prevTxId;
      const maxHops = 1e3;
      for (let i = 0; i < maxHops; i++) {
        const tx = await this.provider.getSourceTransaction(txId);
        if (!tx.inputs || tx.inputs.length === 0) {
          console.debug(`deriveGenesisOutputIndex: TX ${txId.slice(0, 12)}... has no inputs`);
          return null;
        }
        const hop0 = tx.inputs[0];
        const hopPrevTxId = hop0.sourceTXID;
        const hopPrevOutputIndex = hop0.sourceOutputIndex;
        if (!hopPrevTxId) {
          console.debug(`deriveGenesisOutputIndex: Input 0 of ${txId.slice(0, 12)}... has no sourceTXID`);
          return null;
        }
        if (hopPrevTxId === genesisTxId) {
          console.debug(`deriveGenesisOutputIndex: Found genesis output index ${hopPrevOutputIndex} after ${i + 2} hops`);
          return hopPrevOutputIndex;
        }
        txId = hopPrevTxId;
      }
      console.debug(`deriveGenesisOutputIndex: Exceeded max hops (${maxHops})`);
      return null;
    }
    /**
     * Check if a quarantined UTXO is an incoming P token and
     * auto-import it into the store if so. Fire-and-forget.
     */
    async tryAutoImport(u) {
      const utxoKey = `${u.txId}:${u.outputIndex}`;
      const tokenKeys = await this.getTokenUtxoKeys();
      if (tokenKeys.has(utxoKey)) return;
      const tx = await this.provider.getSourceTransaction(u.txId);
      let opData = null;
      let opReturnIndex = -1;
      let hasP2pkhToUs = false;
      let p2pkhOutputIndex = -1;
      for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        if (!output.lockingScript) continue;
        const decoded = decodeOpReturn(output.lockingScript);
        if (decoded) {
          opData = decoded;
          opReturnIndex = i;
          continue;
        }
        if (output.satoshis === TOKEN_SATS) {
          const scriptHex = output.lockingScript.toHex();
          if (isP2pkhToAddress(scriptHex, this.myAddress)) {
            hasP2pkhToUs = true;
            p2pkhOutputIndex = i;
          }
        }
      }
      if (!opData || !hasP2pkhToUs) return;
      const isTransfer = opData.genesisTxId != null;
      const genesisTxId = opData.genesisTxId ?? u.txId;
      let genesisOutputIndex;
      if (isTransfer) {
        const derivedIndex = await this.deriveGenesisOutputIndex(tx, genesisTxId);
        if (derivedIndex === null) {
          console.debug(`tryAutoImport: failed to derive genesisOutputIndex for ${u.txId.slice(0, 12)}...`);
          return;
        }
        genesisOutputIndex = derivedIndex;
      } else {
        genesisOutputIndex = p2pkhOutputIndex;
      }
      const immutableBytes = buildImmutableChunkBytes(
        opData.tokenName,
        opData.tokenScript,
        opData.tokenRules
      );
      const tid = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes);
      const existing = await this.store.getToken(tid);
      if (existing) return;
      const verification = await this.verifyBeforeImport(
        tid,
        genesisTxId,
        genesisOutputIndex,
        immutableBytes,
        opData.proofChainEntries ?? [],
        u.txId
      );
      if (!verification.valid) {
        console.debug(`tryAutoImport: rejected "${opData.tokenName}" from ${u.txId.slice(0, 12)}... \u2014 ${verification.reason}`);
        return;
      }
      const token = {
        tokenId: tid,
        genesisTxId,
        genesisOutputIndex,
        currentTxId: u.txId,
        currentOutputIndex: p2pkhOutputIndex,
        tokenName: opData.tokenName,
        tokenScript: opData.tokenScript,
        tokenRules: opData.tokenRules,
        tokenAttributes: opData.tokenAttributes,
        stateData: opData.stateData,
        satoshis: TOKEN_SATS,
        status: "active",
        blockHeight: 0,
        // Assume unconfirmed for auto-import from quarantine
        confirmationStatus: "unconfirmed",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.store.addToken(token, verification.chain);
      console.debug(`tryAutoImport: imported "${opData.tokenName}" from ${u.txId.slice(0, 12)}... (verified)`);
    }
    // ── Mint ────────────────────────────────────────────────────────
    async createGenesis(params) {
      const address = this.myAddress;
      const utxos = await this.getSafeUtxos();
      if (utxos.length === 0) {
        throw new Error("No spendable UTXOs (token UTXOs are protected). Fund your wallet address first.");
      }
      const tokenScriptHex = params.tokenScript ?? "";
      const tokenRulesHex = encodeTokenRules(
        params.supply ?? 1,
        params.divisibility ?? 0,
        params.restrictions ?? 0,
        params.rulesVersion ?? 1
      );
      let attrsHex;
      let fileOpReturn = null;
      if (params.fileData) {
        const hashBytes = Hash_exports.sha256(Array.from(params.fileData.bytes));
        attrsHex = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        fileOpReturn = buildFileOpReturn({
          mimeType: params.fileData.mimeType,
          fileName: params.fileData.fileName,
          bytes: params.fileData.bytes
        });
      } else {
        attrsHex = params.attributes ?? "00";
      }
      const stateData = params.stateData ?? "";
      const opReturnData = {
        tokenName: params.tokenName,
        tokenScript: tokenScriptHex,
        tokenRules: tokenRulesHex,
        tokenAttributes: attrsHex,
        stateData
      };
      const supply = params.supply ?? 1;
      const divisibility = params.divisibility ?? 0;
      const totalOutputs = divisibility > 0 ? supply * divisibility : supply;
      const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTx(
        utxos,
        address,
        (t) => {
          t.addOutput({
            lockingScript: encodeOpReturn(opReturnData),
            satoshis: 0
          });
          for (let i = 0; i < totalOutputs; i++) {
            t.addOutput({
              lockingScript: new P2PKH().lock(address),
              satoshis: TOKEN_SATS
            });
          }
          if (fileOpReturn) {
            t.addOutput({
              lockingScript: fileOpReturn,
              satoshis: 0
            });
          }
        }
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      const immutableBytes = buildImmutableChunkBytes(
        params.tokenName,
        tokenScriptHex,
        tokenRulesHex
      );
      const tokenIds = [];
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const emptyChain = { genesisTxId: txId, entries: [] };
      for (let i = 1; i <= totalOutputs; i++) {
        const tokenId = computeTokenId(txId, i, immutableBytes);
        tokenIds.push(tokenId);
        const ownedToken = {
          tokenId,
          genesisTxId: txId,
          genesisOutputIndex: i,
          currentTxId: txId,
          currentOutputIndex: i,
          tokenName: params.tokenName,
          tokenScript: tokenScriptHex,
          tokenRules: tokenRulesHex,
          tokenAttributes: attrsHex,
          stateData,
          satoshis: TOKEN_SATS,
          status: "active",
          blockHeight: 0,
          // Newly minted, unconfirmed
          confirmationStatus: "unconfirmed",
          createdAt,
          feePaid: i === 1 ? fee : void 0
        };
        await this.store.addToken(ownedToken, emptyChain);
      }
      return { txId, tokenIds };
    }
    // ── Fungible Mint ─────────────────────────────────────────────────
    async createFungibleGenesis(params) {
      const address = this.myAddress;
      const utxos = await this.getSafeUtxos();
      if (utxos.length === 0) {
        throw new Error("No spendable UTXOs. Fund your wallet address first.");
      }
      if (params.initialSupply < 1) {
        throw new Error("Initial supply must be at least 1 satoshi.");
      }
      const tokenScriptHex = params.tokenScript ?? "";
      const restrictions = (params.restrictions ?? 0) | RESTRICTION_FUNGIBLE;
      const tokenRulesHex = encodeTokenRules(
        1,
        // supply = 1 (single token type)
        0,
        // divisibility = 0
        restrictions,
        params.rulesVersion ?? 1
      );
      const attrsHex = params.attributes ?? "00";
      const stateData = params.stateData ?? "";
      const opReturnData = {
        tokenName: params.tokenName,
        tokenScript: tokenScriptHex,
        tokenRules: tokenRulesHex,
        tokenAttributes: attrsHex,
        stateData
      };
      const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTx(
        utxos,
        address,
        (t) => {
          t.addOutput({
            lockingScript: encodeOpReturn(opReturnData),
            satoshis: 0
          });
          t.addOutput({
            lockingScript: new P2PKH().lock(address),
            satoshis: params.initialSupply
          });
        }
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      const immutableBytes = buildImmutableChunkBytes(
        params.tokenName,
        tokenScriptHex,
        tokenRulesHex
      );
      const tokenId = computeFungibleTokenId(txId, immutableBytes);
      const fungibleToken = {
        tokenId,
        genesisTxId: txId,
        tokenName: params.tokenName,
        tokenScript: tokenScriptHex,
        tokenRules: tokenRulesHex,
        tokenAttributes: attrsHex,
        stateData,
        utxos: [{
          txId,
          outputIndex: 1,
          satoshis: params.initialSupply,
          status: "active",
          blockHeight: 0,
          // Newly minted, unconfirmed
          confirmationStatus: "unconfirmed"
        }],
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        feePaid: fee
      };
      const emptyChain = { genesisTxId: txId, entries: [] };
      await this.store.addFungibleToken(fungibleToken, emptyChain);
      return { txId, tokenId, initialSupply: params.initialSupply };
    }
    // ── Fungible Transfer ─────────────────────────────────────────────
    /**
     * Transfer fungible tokens to a recipient.
     *
     * Spends one or more UTXOs from the basket, creates output to recipient,
     * and returns change to sender (like a standard Bitcoin transaction).
     */
    async transferFungible(tokenId, recipientAddress, amount, newStateData) {
      const token = await this.store.getFungibleToken(tokenId);
      if (!token) throw new Error(`Fungible token not found: ${tokenId}`);
      const activeUtxos = token.utxos.filter((u) => u.status === "active").sort((a, b) => a.satoshis - b.satoshis);
      const totalAvailable = activeUtxos.reduce((sum, u) => sum + u.satoshis, 0);
      if (amount > totalAvailable) {
        throw new Error(`Insufficient balance: have ${totalAvailable}, need ${amount}`);
      }
      if (amount < 1) {
        throw new Error("Amount must be at least 1 satoshi");
      }
      const toSpend = [];
      let selectedTotal = 0;
      for (const utxo of activeUtxos) {
        toSpend.push(utxo);
        selectedTotal += utxo.satoshis;
        if (selectedTotal >= amount) break;
      }
      const change = selectedTotal - amount;
      const fundingUtxos = await this.getSafeUtxos();
      if (fundingUtxos.length === 0) {
        throw new Error("No funding UTXOs available for fees");
      }
      const tokenSourceTxs = [];
      for (const utxo of toSpend) {
        const tx = await this.provider.getSourceTransaction(utxo.txId);
        tokenSourceTxs.push({ tx, outputIndex: utxo.outputIndex });
      }
      const proofChain = await this.store.getProofChain(tokenId);
      const effectiveStateData = newStateData !== void 0 ? newStateData : token.stateData;
      const opReturnData = {
        tokenName: token.tokenName,
        tokenScript: token.tokenScript,
        tokenRules: token.tokenRules,
        tokenAttributes: token.tokenAttributes,
        stateData: effectiveStateData,
        genesisTxId: token.genesisTxId,
        proofChainEntries: proofChain?.entries ?? [],
        genesisOutputIndex: 1
        // Fixed for fungible tokens
      };
      const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedFungibleTransferTx(
        tokenSourceTxs,
        fundingUtxos,
        this.myAddress,
        recipientAddress,
        amount,
        change,
        opReturnData
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      for (const utxo of toSpend) {
        utxo.status = "transferred";
      }
      if (change > 0) {
        token.utxos.push({
          txId,
          outputIndex: 2,
          satoshis: change,
          status: "active"
        });
      }
      if (newStateData !== void 0) {
        token.stateData = newStateData;
      }
      await this.store.updateFungibleToken(token);
      return { txId, tokenId, amountSent: amount, change };
    }
    /**
     * Forward a specific fungible UTXO (typically one with state data/message).
     * Preserves the state data from the original UTXO.
     */
    async forwardFungibleUtxo(tokenId, utxoTxId, utxoOutputIndex, recipientAddress) {
      const token = await this.store.getFungibleToken(tokenId);
      if (!token) throw new Error(`Fungible token not found: ${tokenId}`);
      const utxo = token.utxos.find(
        (u) => u.txId === utxoTxId && u.outputIndex === utxoOutputIndex && u.status === "active"
      );
      if (!utxo) {
        throw new Error(`UTXO not found or not active: ${utxoTxId}:${utxoOutputIndex}`);
      }
      const fundingUtxos = await this.getSafeUtxos();
      if (fundingUtxos.length === 0) {
        throw new Error("No funding UTXOs available for fees");
      }
      const tokenSourceTx = await this.provider.getSourceTransaction(utxo.txId);
      const proofChain = await this.store.getProofChain(tokenId);
      const stateData = utxo.stateData || token.stateData;
      const opReturnData = {
        tokenName: token.tokenName,
        tokenScript: token.tokenScript,
        tokenRules: token.tokenRules,
        tokenAttributes: token.tokenAttributes,
        stateData,
        genesisTxId: token.genesisTxId,
        proofChainEntries: proofChain?.entries ?? [],
        genesisOutputIndex: 1
        // Fixed for fungible tokens
      };
      const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedFungibleTransferTx(
        [{ tx: tokenSourceTx, outputIndex: utxo.outputIndex }],
        fundingUtxos,
        this.myAddress,
        recipientAddress,
        utxo.satoshis,
        // Send entire UTXO
        0,
        // No change
        opReturnData
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      utxo.status = "transferred";
      await this.store.updateFungibleToken(token);
      return { txId, tokenId, amountSent: utxo.satoshis, change: 0 };
    }
    // ── Transfer ──────────────────────────────────────────────────
    async createTransfer(tokenId, recipientAddress, newStateData, fileData, includeStateData = false) {
      const token = await this.store.getToken(tokenId);
      console.debug(`createTransfer DEBUG: tokenId=${tokenId.slice(0, 12)}, genesisTxId=${token?.genesisTxId?.slice(0, 12)}, genesisOutputIndex=${token?.genesisOutputIndex}`);
      if (!token) throw new Error(`Token not found: ${tokenId}. Make sure you are using the Token ID (not a TXID).`);
      if (token.status === "pending_transfer") {
        throw new Error(`Token already has a pending transfer (TXID: ${token.transferTxId}). Confirm or cancel it first.`);
      }
      if (token.status === "transferred") {
        throw new Error("Token has already been transferred.");
      }
      const actualTokenId = token.tokenId;
      const proofChain = await this.store.getProofChain(actualTokenId);
      const tokenSourceTx = await this.provider.getSourceTransaction(token.currentTxId);
      const fundingCandidates = await this.getSafeUtxos();
      if (fundingCandidates.length === 0) {
        throw new Error("No funding UTXOs available (token UTXOs are protected)");
      }
      let effectiveStateData;
      let fileOpReturn = null;
      if (fileData) {
        fileOpReturn = buildFileOpReturn({
          mimeType: fileData.mimeType,
          fileName: fileData.fileName,
          bytes: fileData.bytes
        });
      }
      effectiveStateData = newStateData !== void 0 ? newStateData : includeStateData ? token.stateData : "";
      const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTransferTx(
        tokenSourceTx,
        token.currentOutputIndex,
        fundingCandidates,
        this.myAddress,
        (tx) => {
          tx.addOutput({
            lockingScript: new P2PKH().lock(recipientAddress),
            satoshis: TOKEN_SATS
          });
          const opReturnScript = encodeOpReturn({
            tokenName: token.tokenName,
            tokenScript: token.tokenScript,
            tokenRules: token.tokenRules,
            tokenAttributes: token.tokenAttributes,
            stateData: effectiveStateData,
            genesisTxId: token.genesisTxId,
            proofChainEntries: (proofChain ?? { genesisTxId: token.genesisTxId, entries: [] }).entries
          });
          console.debug(`buildFundedTransferTx: OP_RETURN script encoded, binary length=${opReturnScript.toBinary().length}, hex=${opReturnScript.toHex().substring(0, 100)}...`);
          tx.addOutput({
            lockingScript: opReturnScript,
            satoshis: 0
          });
          if (fileOpReturn) {
            tx.addOutput({
              lockingScript: fileOpReturn,
              satoshis: 0
            });
          }
        }
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      token.status = "pending_transfer";
      token.transferTxId = txId;
      await this.store.updateToken(token);
      return { txId, tokenId: actualTokenId };
    }
    async confirmTransfer(tokenId) {
      const token = await this.store.getToken(tokenId);
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      if (token.status !== "pending_transfer") {
        throw new Error("Token is not in pending_transfer state");
      }
      token.status = "transferred";
      await this.store.updateToken(token);
    }
    // ── File Retrieval from Genesis TX ──────────────────────────
    async fetchFileFromGenesis(genesisTxId, expectedHash) {
      const tx = await this.provider.getSourceTransaction(genesisTxId);
      for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        if (!output.lockingScript) continue;
        const file = parseFileOpReturn(output.lockingScript);
        if (!file) continue;
        const hashBytes = Hash_exports.sha256(Array.from(file.bytes));
        const computedHash = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        if (computedHash !== expectedHash) continue;
        return file;
      }
      return null;
    }
    // ── Send BSV ──────────────────────────────────────────────────
    async sendSats(recipientAddress, amount) {
      if (amount < 1) throw new Error("Amount must be at least 1 satoshi");
      const utxos = await this.getSafeUtxos();
      if (utxos.length === 0) throw new Error("No spendable UTXOs (token UTXOs are protected). Fund your wallet first.");
      const { txId, rawHex, fee, spentInputs, changeOutput } = await this.buildFundedTx(
        utxos,
        this.myAddress,
        (tx) => {
          tx.addOutput({
            lockingScript: new P2PKH().lock(recipientAddress),
            satoshis: amount
          });
        }
      );
      await this.provider.broadcast(rawHex);
      this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? void 0);
      return { txId, fee };
    }
    // ── Transfer Confirmation Polling ────────────────────────────
    async pollForConfirmation(txId, onStatus, maxAttempts = 60, intervalMs = 6e4) {
      for (let i = 0; i < maxAttempts; i++) {
        onStatus?.(`Waiting for confirmation... (attempt ${i + 1}/${maxAttempts})`);
        try {
          const proof = await this.provider.getMerkleProof(txId);
          if (proof) {
            onStatus?.("Transaction confirmed!");
            return true;
          }
        } catch {
        }
        await new Promise((r2) => setTimeout(r2, intervalMs));
      }
      onStatus?.("Timed out waiting for confirmation.");
      return false;
    }
    // ── Proof Polling ─────────────────────────────────────────────
    async pollForProof(tokenId, txId, onStatus, maxAttempts = 240, intervalMs = 15e3) {
      for (let i = 0; i < maxAttempts; i++) {
        onStatus?.(`Waiting for confirmation... (attempt ${i + 1}/${maxAttempts})`);
        try {
          const proof = await this.provider.getMerkleProof(txId);
          if (!proof) throw new Error("not yet");
          const existing = await this.store.getProofChain(tokenId);
          const token = await this.store.getToken(tokenId);
          if (!token) return false;
          let chain;
          if (!existing || existing.entries.length === 0) {
            chain = createProofChain(txId, proof);
          } else {
            chain = extendProofChain(existing, proof);
          }
          await this.store.addToken(token, chain);
          onStatus?.("Proof chain updated!");
          return true;
        } catch {
          await new Promise((r2) => setTimeout(r2, intervalMs));
        }
      }
      onStatus?.("Timed out waiting for confirmation.");
      return false;
    }
    async fetchMissingProofs(onStatus) {
      const tokens = await this.store.listTokens();
      let fetched = 0;
      for (const token of tokens) {
        if (token.status === "transferred") continue;
        const chain = await this.store.getProofChain(token.tokenId);
        if (chain && chain.entries.length > 0) continue;
        const txId = token.currentTxId;
        onStatus?.(`Fetching proof for ${token.tokenName}...`);
        try {
          const proof = await this.provider.getMerkleProof(txId);
          if (!proof) {
            console.debug(`fetchMissingProofs: no proof yet for ${token.tokenName} (${txId.slice(0, 12)}...)`);
            continue;
          }
          const newChain = createProofChain(token.genesisTxId, proof);
          await this.store.addToken(token, newChain);
          fetched++;
          onStatus?.(`Got proof for ${token.tokenName}`);
        } catch (e) {
          console.warn(`fetchMissingProofs: error fetching proof for ${token.tokenName}:`, e);
          continue;
        }
      }
      return fetched;
    }
    // ── Token Flushing (v05.23) ───────────────────────────────────
    /**
     * Flush an NFT token: mark it as flushed (internal state only, no blockchain transaction).
     * Optionally preserve metadata in localStorage; if not preserved, token is deleted.
     */
    async flushToken(tokenId, preserveMetadata = true) {
      const token = await this.store.getToken(tokenId);
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      if (token.status === "flushed" || token.status === "recovered") {
        throw new Error(`Token is already flushed (status: ${token.status})`);
      }
      if (token.status === "pending_transfer") {
        throw new Error("Cannot flush token with pending transfer");
      }
      if (token.status === "transferred") {
        throw new Error("Cannot flush token that has been transferred away");
      }
      token.status = "flushed";
      const flushedAt = (/* @__PURE__ */ new Date()).toISOString();
      token.flushedAt = flushedAt;
      if (!preserveMetadata) {
        await this.store.deleteToken(tokenId);
        console.debug(`flushToken: deleted token ${tokenId} (metadata not preserved)`);
      } else {
        await this.store.updateToken(token);
        console.debug(`flushToken: marked token ${tokenId} as flushed (metadata preserved)`);
      }
      return { tokenId, flushedAt };
    }
    /**
     * Flush fungible token UTXO(s): mark them as flushed (internal state only, no blockchain transaction).
     */
    async flushFungibleToken(tokenId, utxoIndexes, preserveMetadata = true) {
      const fungible = await this.store.getFungibleToken(tokenId);
      if (!fungible) throw new Error(`Fungible token not found: ${tokenId}`);
      if (utxoIndexes.length === 0) {
        throw new Error("No UTXOs specified to flush");
      }
      const utxosToFlush = utxoIndexes.map((idx) => fungible.utxos[idx]).filter((u) => u !== void 0);
      if (utxosToFlush.length !== utxoIndexes.length) {
        throw new Error("Invalid UTXO indices");
      }
      for (const utxo of utxosToFlush) {
        if (utxo.status === "pending_transfer" || utxo.status === "flushed") {
          throw new Error(`Cannot flush UTXO with status: ${utxo.status}`);
        }
      }
      const amountFlushed = utxosToFlush.reduce((sum, u) => sum + u.satoshis, 0);
      const flushedAt = (/* @__PURE__ */ new Date()).toISOString();
      for (let i = 0; i < fungible.utxos.length; i++) {
        if (utxoIndexes.includes(i)) {
          fungible.utxos[i].status = "flushed";
          fungible.utxos[i].flushedAt = flushedAt;
        }
      }
      if (!preserveMetadata) {
        fungible.utxos = fungible.utxos.filter((_, i) => !utxoIndexes.includes(i));
        if (fungible.utxos.length === 0) {
          await this.store.deleteFungibleToken(tokenId);
          console.debug(`flushFungibleToken: deleted entire token ${tokenId} (no UTXOs remain)`);
        } else {
          await this.store.updateFungibleToken(fungible);
          console.debug(`flushFungibleToken: removed ${utxoIndexes.length} UTXOs from ${tokenId}`);
        }
      } else {
        await this.store.updateFungibleToken(fungible);
        console.debug(`flushFungibleToken: marked ${utxoIndexes.length} UTXOs as flushed in ${tokenId}`);
      }
      return {
        tokenId,
        amountFlushed,
        flushedAt
      };
    }
    // ── Incoming Token Detection ──────────────────────────────────
    async checkIncomingTokens(onStatus) {
      onStatus?.("Fetching transactions...");
      const [history, utxos] = await Promise.all([
        this.provider.getAddressHistory(),
        this.provider.getUtxos()
      ]);
      const txIdSet = /* @__PURE__ */ new Set();
      for (const h of history) txIdSet.add(h.txId);
      for (const u of utxos) txIdSet.add(u.txId);
      const unspentSet = /* @__PURE__ */ new Set();
      for (const u of utxos) {
        unspentSet.add(`${u.txId}:${u.outputIndex}`);
      }
      const allTxIds = Array.from(txIdSet);
      if (allTxIds.length === 0) {
        onStatus?.("No transactions found.");
        return [];
      }
      const imported = [];
      const existingTokens = await this.store.listTokens();
      const existingFungibleTokens = await this.store.listFungibleTokens();
      const nftTxIds = /* @__PURE__ */ new Set();
      for (const t of existingTokens) {
        nftTxIds.add(t.currentTxId);
        nftTxIds.add(t.genesisTxId);
      }
      const knownFungibleUtxos = /* @__PURE__ */ new Set();
      for (const ft of existingFungibleTokens) {
        for (const u of ft.utxos) {
          knownFungibleUtxos.add(`${u.txId}:${u.outputIndex}`);
        }
      }
      const txsWithPotentialNewUtxos = /* @__PURE__ */ new Set();
      for (const u of utxos) {
        if (!knownFungibleUtxos.has(`${u.txId}:${u.outputIndex}`)) {
          txsWithPotentialNewUtxos.add(u.txId);
        }
      }
      onStatus?.(`Scanning ${allTxIds.length} transactions...`);
      console.debug(`checkIncoming: my address = ${this.myAddress}`);
      console.debug(`checkIncoming: NFT TXs=${nftTxIds.size}, knownFungibleUtxos=${knownFungibleUtxos.size}, txsWithPotentialNew=${txsWithPotentialNewUtxos.size}`);
      let skippedConfirmed = 0;
      for (const txId of allTxIds) {
        const historyEntry = history.find((h) => h.txId === txId);
        const blockHeight = historyEntry?.blockHeight ?? 0;
        if (blockHeight > 0 && !txsWithPotentialNewUtxos.has(txId)) {
          skippedConfirmed++;
          continue;
        }
        if (nftTxIds.has(txId) && !txsWithPotentialNewUtxos.has(txId)) {
          console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (known NFT TX, no new UTXOs)`);
          continue;
        }
        if (!txsWithPotentialNewUtxos.has(txId) && !nftTxIds.has(txId)) {
          const hasUnknownUtxo = utxos.some((u) => u.txId === txId && !knownFungibleUtxos.has(`${u.txId}:${u.outputIndex}`));
          if (!hasUnknownUtxo) {
            console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (all UTXOs already known)`);
            continue;
          }
        }
        try {
          const tx = await this.provider.getSourceTransaction(txId);
          let opData = null;
          const p2pkhOutputIndices = [];
          const p2pkhOutputsWithSats = [];
          console.debug(`checkIncoming: ${txId.slice(0, 12)}... has ${tx.outputs.length} outputs`);
          for (let i = 0; i < tx.outputs.length; i++) {
            const output = tx.outputs[i];
            if (!output.lockingScript) continue;
            const scriptHex = output.lockingScript.toHex();
            const sats = output.satoshis ?? 0;
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] sats=${sats} scriptLen=${scriptHex.length / 2} scriptHead=${scriptHex.slice(0, 30)}...`);
            const decoded = decodeOpReturn(output.lockingScript);
            if (decoded) {
              opData = decoded;
              console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] = P OP_RETURN "${decoded.tokenName}" (isTransfer=${decoded.genesisTxId != null})`);
              continue;
            }
            if (scriptHex.includes("006a") || scriptHex.startsWith("6a")) {
              const fileData = parseFileOpReturn(output.lockingScript);
              if (fileData) {
                const hashBytes = Hash_exports.sha256(Array.from(fileData.bytes));
                const fileHash = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
                const FILE_META_KEY = "p:fileMeta";
                try {
                  const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || "{}");
                  data[fileHash] = { mimeType: fileData.mimeType, fileName: fileData.fileName };
                  localStorage.setItem(FILE_META_KEY, JSON.stringify(data));
                  console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] = file OP_RETURN "${fileData.fileName}" (hash=${fileHash.slice(0, 16)}...)`);
                } catch (e) {
                  console.debug(`checkIncoming: failed to store file metadata:`, e);
                }
                continue;
              }
              const chunks = output.lockingScript.chunks;
              console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] looks like OP_RETURN but decode failed. chunks=${chunks.length}, chunk ops=[${chunks.slice(0, 5).map((c) => c.op.toString(16)).join(",")}]`);
              if (chunks.length >= 3) {
                const prefixData = chunks[2]?.data ?? [];
                console.debug(`checkIncoming:   chunk[2] data=[${prefixData.slice(0, 5).join(",")}] (expecting 80 = "P")`);
              }
              if (chunks.length >= 4) {
                const versionData = chunks[3]?.data ?? [];
                console.debug(`checkIncoming:   chunk[3] data=[${versionData.join(",")}] (expecting [1])`);
              }
            }
            const match = isP2pkhToAddress(scriptHex, this.myAddress);
            if (match) {
              console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] P2PKH match, sats=${sats}`);
              p2pkhOutputsWithSats.push({ index: i, sats });
              if (sats === TOKEN_SATS) {
                p2pkhOutputIndices.push(i);
              }
            }
          }
          const isFungible = opData ? decodeTokenRules(opData.tokenRules).isFungible : false;
          const isTxTransfer = opData?.genesisTxId != null;
          const historyEntry2 = history.find((h) => h.txId === txId);
          const blockHeight2 = historyEntry2?.blockHeight ?? 0;
          const unspentP2pkhIndices = p2pkhOutputIndices.filter(
            (i) => blockHeight2 === 0 || unspentSet.has(`${txId}:${i}`)
          );
          const validFungibleIndices = isTxTransfer ? [0, 2] : [1];
          const fungibleOutputs = isFungible ? p2pkhOutputsWithSats.filter((o) => o.sats > 0 && validFungibleIndices.includes(o.index) && (blockHeight2 === 0 || unspentSet.has(`${txId}:${o.index}`))) : p2pkhOutputsWithSats.filter((o) => o.sats > 0 && o.sats !== TOKEN_SATS && (blockHeight2 === 0 || unspentSet.has(`${txId}:${o.index}`)));
          if (!opData || unspentP2pkhIndices.length === 0 && fungibleOutputs.length === 0) {
            console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (opData=${!!opData}, nftMatches=${unspentP2pkhIndices.length}, fungibleMatches=${fungibleOutputs.length})`);
            continue;
          }
          const immutableBytes = buildImmutableChunkBytes(
            opData.tokenName,
            opData.tokenScript,
            opData.tokenRules
          );
          const isTransfer = opData.genesisTxId != null;
          const genesisTxId = isTransfer ? opData.genesisTxId : txId;
          if (isFungible && fungibleOutputs.length > 0) {
            const genesisOutputIndex = 1;
            const tokenId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes);
            const verification = await this.verifyBeforeImport(
              tokenId,
              genesisTxId,
              genesisOutputIndex,
              immutableBytes,
              opData.proofChainEntries ?? [],
              txId
            );
            if (!verification.valid) {
              onStatus?.(`Rejected fungible token: ${opData.tokenName} \u2014 ${verification.reason}`);
              continue;
            }
            let fungibleToken = await this.store.getFungibleToken(tokenId);
            if (fungibleToken) {
              const now = (/* @__PURE__ */ new Date()).toISOString();
              for (const output of fungibleOutputs) {
                const existingUtxo = fungibleToken.utxos.find(
                  (u) => u.txId === txId && u.outputIndex === output.index
                );
                if (!existingUtxo) {
                  fungibleToken.utxos.push({
                    txId,
                    outputIndex: output.index,
                    satoshis: output.sats,
                    status: "active",
                    // Always active (pure SPV)
                    stateData: opData.stateData || void 0,
                    // Per-UTXO state data
                    receivedAt: now,
                    blockHeight: blockHeight2,
                    confirmationStatus: blockHeight2 === 0 ? "unconfirmed" : "confirmed"
                  });
                  const confirmLabel = blockHeight2 === 0 ? " (unconfirmed)" : "";
                  onStatus?.(`Found fungible UTXO: ${opData.tokenName} +${output.sats} sats${confirmLabel}`);
                } else if (existingUtxo.blockHeight === 0 && blockHeight2 > 0) {
                  existingUtxo.blockHeight = blockHeight2;
                  existingUtxo.confirmationStatus = "confirmed";
                  onStatus?.(`Confirmed fungible UTXO: ${opData.tokenName} +${output.sats} sats`);
                }
              }
              fungibleToken.stateData = opData.stateData;
              await this.store.updateFungibleToken(fungibleToken);
            } else {
              const now = (/* @__PURE__ */ new Date()).toISOString();
              fungibleToken = {
                tokenId,
                genesisTxId,
                tokenName: opData.tokenName,
                tokenScript: opData.tokenScript,
                tokenRules: opData.tokenRules,
                tokenAttributes: opData.tokenAttributes,
                stateData: opData.stateData,
                utxos: fungibleOutputs.map((o) => ({
                  txId,
                  outputIndex: o.index,
                  satoshis: o.sats,
                  status: "active",
                  // Always active (pure SPV)
                  stateData: opData.stateData || void 0,
                  // Per-UTXO state data
                  receivedAt: now,
                  blockHeight: blockHeight2,
                  confirmationStatus: blockHeight2 === 0 ? "unconfirmed" : "confirmed"
                })),
                createdAt: now
              };
              await this.store.addFungibleToken(fungibleToken, verification.chain);
              const confirmLabel = blockHeight2 === 0 ? " (unconfirmed)" : "";
              onStatus?.(`Found fungible token: ${opData.tokenName}${confirmLabel} (${fungibleOutputs.reduce((s2, o) => s2 + o.sats, 0)} sats)`);
            }
            continue;
          }
          if (unspentP2pkhIndices.length === 0) {
            continue;
          }
          if (isTransfer) {
            const p2pkhOutputIndex = unspentP2pkhIndices[0];
            console.debug(`checkIncoming TRANSFER: txId=${txId.slice(0, 12)}..., genesisTxId=${genesisTxId?.slice(0, 12)}..., p2pkhOutputIndex=${p2pkhOutputIndex}`);
            const genesisOutputIndex = await this.deriveGenesisOutputIndex(tx, genesisTxId);
            if (genesisOutputIndex === null) {
              console.debug(`checkIncoming TRANSFER: failed to derive genesisOutputIndex for ${txId.slice(0, 12)}...`);
              continue;
            }
            console.debug(`checkIncoming TRANSFER: derived genesisOutputIndex=${genesisOutputIndex}`);
            const tokenId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes);
            const verification = await this.verifyBeforeImport(
              tokenId,
              genesisTxId,
              genesisOutputIndex,
              immutableBytes,
              opData.proofChainEntries ?? [],
              txId
            );
            if (!verification.valid) {
              onStatus?.(`Rejected token: ${opData.tokenName} \u2014 ${verification.reason}`);
              continue;
            }
            const existing = await this.store.getToken(tokenId);
            if (existing && existing.status === "active") continue;
            if (existing && existing.status === "pending" && !isUnconfirmedTx) {
              existing.status = "active";
              await this.store.updateToken(existing);
              onStatus?.(`Confirmed token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`);
              continue;
            }
            if (existing && existing.status === "pending") continue;
            if (existing && (existing.status === "transferred" || existing.status === "pending_transfer")) {
              existing.status = "active";
              existing.currentTxId = txId;
              existing.currentOutputIndex = p2pkhOutputIndex;
              existing.transferTxId = void 0;
              existing.stateData = opData.stateData;
              await this.store.updateToken(existing);
              await this.store.addToken(existing, verification.chain);
              imported.push(existing);
              onStatus?.(`Returned token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`);
              continue;
            } else if (!existing) {
              const token = {
                tokenId,
                genesisTxId,
                genesisOutputIndex,
                currentTxId: txId,
                currentOutputIndex: p2pkhOutputIndex,
                tokenName: opData.tokenName,
                tokenScript: opData.tokenScript,
                tokenRules: opData.tokenRules,
                tokenAttributes: opData.tokenAttributes,
                stateData: opData.stateData,
                satoshis: TOKEN_SATS,
                status: "active",
                // Always active (pure SPV)
                blockHeight: blockHeight2,
                confirmationStatus: blockHeight2 === 0 ? "unconfirmed" : "confirmed",
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              };
              console.debug(`[tokenBuilder] Token received for address extraction check`);
              console.debug(`[tokenBuilder] tokenName="${opData.tokenName}", isTransfer=${isTransfer}, p2pkhOutputIndex=${p2pkhOutputIndex}`);
              console.debug(`[tokenBuilder] tx.outputs.length=${tx.outputs.length}, tx.inputs.length=${tx.inputs?.length}`);
              console.debug(`[tokenBuilder] Checking token type: tokenName="${opData.tokenName}", startsWith('CALL-')=${opData.tokenName?.startsWith("CALL-")}`);
              if (opData.tokenName?.startsWith("CALL-")) {
                console.log(`[tokenBuilder] \u{1F4DE} CALL token detected: ${opData.tokenName}, extracting addresses from tx`);
                try {
                  const calleeOutput = tx.outputs[p2pkhOutputIndex];
                  console.debug(`[tokenBuilder] calleeOutput at index ${p2pkhOutputIndex}:`, {
                    exists: !!calleeOutput,
                    hasLockingScript: !!calleeOutput?.lockingScript
                  });
                  if (calleeOutput?.lockingScript) {
                    const calleeAddrScript = calleeOutput.lockingScript.toHex();
                    console.debug(`[tokenBuilder] Callee script hex: ${calleeAddrScript}`);
                    const calleeAddr = extractAddressFromP2pkhScript(calleeAddrScript);
                    if (calleeAddr) {
                      token.callee = calleeAddr;
                      console.log(`[tokenBuilder] \u2705 CALLEE extracted: ${calleeAddr}`);
                    } else {
                      console.warn(`[tokenBuilder] \u26A0\uFE0F Could not extract callee from P2PKH script: ${calleeAddrScript}`);
                    }
                  } else {
                    console.warn(`[tokenBuilder] \u26A0\uFE0F calleeOutput or lockingScript missing at index ${p2pkhOutputIndex}`);
                  }
                  if (tx.inputs?.length > 0) {
                    const txType = isTransfer ? "TRANSFER" : "GENESIS";
                    console.log(`[tokenBuilder] \u{1F4E1} CALL ${txType}: extracting caller from input 0`);
                    try {
                      const input0 = tx.inputs[0];
                      console.debug(`[tokenBuilder] Input 0 details:`, {
                        hasSourcTXID: !!input0.sourceTXID,
                        hasSourceOutputIndex: input0.sourceOutputIndex !== void 0,
                        hasSourceOutput: !!input0.sourceOutput
                      });
                      let callerAddr = extractCallerFromSPVEnvelope(input0);
                      if (!callerAddr) {
                        console.debug(`[tokenBuilder] Method 1 unavailable, trying Method 2...`);
                        callerAddr = await extractCallerFromBlockchain(this.provider, input0);
                      }
                      if (callerAddr) {
                        token.caller = callerAddr;
                        console.log(`[tokenBuilder] \u2705 CALLER extracted: ${callerAddr}`);
                      } else {
                        console.warn(`[tokenBuilder] \u26A0\uFE0F Could not extract caller (both methods failed)`);
                      }
                    } catch (e) {
                      console.error(`[tokenBuilder] \u274C Unexpected error extracting caller: ${e?.message}`);
                    }
                  } else {
                    console.warn(`[tokenBuilder] \u26A0\uFE0F No inputs in transaction`);
                  }
                } catch (e) {
                  console.error(`[tokenBuilder] \u274C Error extracting CALL token addresses: ${e?.message}`);
                }
                console.log(`[tokenBuilder] \u2713 CALL token address extraction complete:`, {
                  tokenName: token.tokenName,
                  caller: token.caller?.slice(0, 20),
                  callee: token.callee?.slice(0, 20)
                });
              }
              await this.store.addToken(token, verification.chain);
              imported.push(token);
              const confirmLabel = blockHeight2 === 0 ? " (unconfirmed)" : "";
              onStatus?.(`Found token: ${token.tokenName}${confirmLabel} (${tokenId.slice(0, 12)}...)`);
            }
          } else {
            const firstTokenId = computeTokenId(genesisTxId, unspentP2pkhIndices[0], immutableBytes);
            const genesisVerification = await this.verifyBeforeImport(
              firstTokenId,
              genesisTxId,
              unspentP2pkhIndices[0],
              immutableBytes,
              [],
              txId
            );
            if (!genesisVerification.valid) {
              onStatus?.(`Rejected token: ${opData.tokenName} \u2014 ${genesisVerification.reason}`);
              continue;
            }
            for (const p2pkhOutputIndex of unspentP2pkhIndices) {
              const tokenId = computeTokenId(genesisTxId, p2pkhOutputIndex, immutableBytes);
              const existing = await this.store.getToken(tokenId);
              if (existing && existing.status === "active") {
                if (existing.blockHeight === 0 && blockHeight2 > 0) {
                  existing.blockHeight = blockHeight2;
                  existing.confirmationStatus = "confirmed";
                  await this.store.updateToken(existing);
                  onStatus?.(`Confirmed token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`);
                }
                continue;
              }
              if (existing && (existing.status === "transferred" || existing.status === "pending_transfer")) {
                existing.status = "active";
                existing.currentTxId = txId;
                existing.currentOutputIndex = p2pkhOutputIndex;
                existing.transferTxId = void 0;
                await this.store.updateToken(existing);
                imported.push(existing);
                onStatus?.(`Returned token: ${existing.tokenName} #${p2pkhOutputIndex} (${tokenId.slice(0, 12)}...)`);
                continue;
              }
              console.debug(`checkIncoming GENESIS: p2pkhOutputIndex=${p2pkhOutputIndex}`);
              const token = {
                tokenId,
                genesisTxId,
                genesisOutputIndex: p2pkhOutputIndex,
                currentTxId: txId,
                currentOutputIndex: p2pkhOutputIndex,
                tokenName: opData.tokenName,
                tokenScript: opData.tokenScript,
                tokenRules: opData.tokenRules,
                tokenAttributes: opData.tokenAttributes,
                stateData: opData.stateData,
                satoshis: TOKEN_SATS,
                status: "active",
                // Always active (pure SPV)
                blockHeight: blockHeight2,
                confirmationStatus: blockHeight2 === 0 ? "unconfirmed" : "confirmed",
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              };
              console.debug(`[tokenBuilder] Checking Genesis token type: tokenName="${opData.tokenName}", startsWith('CALL-')=${opData.tokenName?.startsWith("CALL-")}`);
              if (opData.tokenName?.startsWith("CALL-")) {
                console.log(`[tokenBuilder] \u{1F4DE} CALL token (GENESIS) detected: ${opData.tokenName}, extracting addresses from tx`);
                try {
                  const calleeOutput = tx.outputs[p2pkhOutputIndex];
                  console.debug(`[tokenBuilder] GENESIS: calleeOutput at index ${p2pkhOutputIndex}:`, {
                    exists: !!calleeOutput,
                    hasLockingScript: !!calleeOutput?.lockingScript
                  });
                  if (calleeOutput?.lockingScript) {
                    const calleeAddrScript = calleeOutput.lockingScript.toHex();
                    console.debug(`[tokenBuilder] GENESIS: Callee script hex: ${calleeAddrScript}`);
                    const calleeAddr = extractAddressFromP2pkhScript(calleeAddrScript);
                    if (calleeAddr) {
                      token.callee = calleeAddr;
                      console.log(`[tokenBuilder] \u2705 CALLEE (GENESIS) extracted: ${calleeAddr}`);
                    } else {
                      console.warn(`[tokenBuilder] \u26A0\uFE0F Could not extract callee from P2PKH script: ${calleeAddrScript}`);
                    }
                    if (tx.inputs?.length > 0) {
                      console.log(`[tokenBuilder] \u{1F4E1} CALL GENESIS: extracting caller from input 0`);
                      try {
                        const input0 = tx.inputs[0];
                        console.debug(`[tokenBuilder] GENESIS: Input 0 details:`, {
                          hasSourceTXID: !!input0.sourceTXID,
                          hasSourceOutputIndex: input0.sourceOutputIndex !== void 0,
                          hasSourceOutput: !!input0.sourceOutput
                        });
                        let callerAddr = extractCallerFromSPVEnvelope(input0);
                        if (!callerAddr) {
                          console.debug(`[tokenBuilder] GENESIS: Method 1 unavailable, trying Method 2...`);
                          callerAddr = await extractCallerFromBlockchain(this.provider, input0);
                        }
                        if (callerAddr) {
                          token.caller = callerAddr;
                          console.log(`[tokenBuilder] \u2705 CALLER (GENESIS) extracted: ${callerAddr}`);
                        } else {
                          console.warn(`[tokenBuilder] \u26A0\uFE0F Could not extract caller (both methods failed)`);
                        }
                      } catch (e) {
                        console.error(`[tokenBuilder] \u274C Unexpected error extracting caller: ${e?.message}`);
                      }
                    } else {
                      console.warn(`[tokenBuilder] \u26A0\uFE0F No inputs in GENESIS transaction`);
                    }
                  } else {
                    console.warn(`[tokenBuilder] \u26A0\uFE0F GENESIS: calleeOutput or lockingScript missing at index ${p2pkhOutputIndex}`);
                  }
                } catch (e) {
                  console.error(`[tokenBuilder] \u274C Error extracting CALL token addresses (GENESIS): ${e?.message}`);
                }
                console.log(`[tokenBuilder] \u2713 CALL token (GENESIS) address extraction complete:`, {
                  tokenName: token.tokenName,
                  caller: token.caller?.slice(0, 20),
                  callee: token.callee?.slice(0, 20)
                });
              }
              await this.store.addToken(token, genesisVerification.chain);
              imported.push(token);
              const confirmLabel = blockHeight2 === 0 ? " (unconfirmed)" : "";
              onStatus?.(`Found token: ${token.tokenName}${confirmLabel} #${p2pkhOutputIndex} (${tokenId.slice(0, 12)}...)`);
            }
          }
        } catch (e) {
          console.debug(`checkIncoming: skipping TX ${txId}:`, e);
          continue;
        }
      }
      console.debug(`checkIncoming: Completed scan. Skipped ${skippedConfirmed} confirmed TXs, imported ${imported.length} new token(s).`);
      onStatus?.(imported.length > 0 ? `Done! Imported ${imported.length} token(s).` : "No new incoming tokens found.");
      return imported;
    }
    // ── Verification (delegates to SPV token protocol) ────────────
    /**
     * Verify a token using the pure SPV protocol.
     *
     * Fetches block headers from the wallet provider, then hands
     * everything to tokenProtocol.verifyToken() which does the
     * actual cryptographic verification with no network calls.
     */
    async verifyToken(tokenId) {
      let token = await this.store.getToken(tokenId);
      if (!token) {
        const fungibleToken = await this.store.getFungibleToken(tokenId);
        if (fungibleToken) {
          token = {
            tokenId: fungibleToken.tokenId,
            genesisTxId: fungibleToken.genesisTxId,
            genesisOutputIndex: 1,
            currentTxId: fungibleToken.utxos[0]?.txId || fungibleToken.genesisTxId,
            currentOutputIndex: fungibleToken.utxos[0]?.outputIndex || 1,
            tokenName: fungibleToken.tokenName,
            tokenScript: fungibleToken.tokenScript,
            tokenRules: fungibleToken.tokenRules,
            tokenAttributes: fungibleToken.tokenAttributes,
            stateData: fungibleToken.stateData,
            satoshis: fungibleToken.utxos.reduce((sum, u) => sum + u.satoshis, 0),
            status: "active"
          };
        }
      }
      if (!token) return { valid: false, reason: "Token not found" };
      let chain = await this.store.getProofChain(tokenId);
      if (!chain || chain.entries.length === 0) {
        try {
          const proof = await this.provider.getMerkleProof(token.currentTxId);
          if (proof) {
            chain = createProofChain(token.genesisTxId, proof);
            await this.store.addToken(token, chain);
          }
        } catch (e) {
          console.warn("verifyToken: failed to fetch Merkle proof on demand:", e);
        }
      }
      if (!chain || chain.entries.length === 0) {
        return { valid: false, reason: "No proof chain (TX may not be confirmed yet)" };
      }
      const immutableBytes = buildImmutableChunkBytes(
        token.tokenName,
        token.tokenScript,
        token.tokenRules
      );
      const expectedId = computeTokenId(token.genesisTxId, token.genesisOutputIndex, immutableBytes);
      if (expectedId !== token.tokenId) {
        return { valid: false, reason: "Token ID does not match genesis" };
      }
      return verifyProofChainAsync(chain, async (height) => {
        return this.provider.getBlockHeader(height);
      });
    }
    // ── Transaction Building (wallet internals) ───────────────────
    async buildFundedTx(utxos, changeAddress, addOutputs) {
      const sorted = [...utxos].sort((a, b) => a.satoshis - b.satoshis);
      const combos = [];
      for (const u of sorted) combos.push([u]);
      if (sorted.length >= 2) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            combos.push([sorted[i], sorted[j]]);
      }
      if (sorted.length >= 3) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            for (let k = j + 1; k < sorted.length; k++)
              combos.push([sorted[i], sorted[j], sorted[k]]);
      }
      combos.sort(
        (a, b) => a.reduce((s2, u) => s2 + u.satoshis, 0) - b.reduce((s2, u) => s2 + u.satoshis, 0)
      );
      let lastError = "";
      for (const combo of combos) {
        const tx = new Transaction();
        for (const u of combo) {
          const sourceTx = await this.provider.getSourceTransaction(u.txId);
          tx.addInput({
            sourceTransaction: sourceTx,
            sourceOutputIndex: u.outputIndex,
            unlockingScriptTemplate: new P2PKH().unlock(this.key)
          });
        }
        addOutputs(tx);
        const fee = estimateFee(combo.length, tx.outputs.length + 1, tx.outputs, this.feePerKb);
        const totalIn = combo.reduce((s2, u) => s2 + u.satoshis, 0);
        const protocolOut = tx.outputs.reduce((s2, o) => s2 + (o.satoshis ?? 0), 0);
        const changeAmount = totalIn - protocolOut - fee;
        if (changeAmount < 0) {
          lastError = `${combo.length} UTXO(s) totalling ${totalIn} sats too small for fees (need ${fee} sats)`;
          continue;
        }
        const changeOutputIndex = tx.outputs.length;
        tx.addOutput({
          lockingScript: new P2PKH().lock(changeAddress),
          satoshis: changeAmount
        });
        await tx.sign();
        const txId = tx.id("hex");
        return {
          tx,
          rawHex: tx.toHex(),
          txId,
          fee,
          spentInputs: combo.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
          changeOutput: changeAmount > 0 ? { outputIndex: changeOutputIndex, satoshis: changeAmount } : null
        };
      }
      const totalBalance = utxos.reduce((s2, u) => s2 + u.satoshis, 0);
      throw new Error(
        `Insufficient balance (${totalBalance} sats) to cover transaction fees. ${lastError}`
      );
    }
    async buildFundedTransferTx(tokenSourceTx, tokenOutputIndex, fundingUtxos, changeAddress, addOutputs) {
      const sorted = [...fundingUtxos].sort((a, b) => a.satoshis - b.satoshis);
      const combos = [];
      for (const u of sorted) combos.push([u]);
      if (sorted.length >= 2) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            combos.push([sorted[i], sorted[j]]);
      }
      if (sorted.length >= 3) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            for (let k = j + 1; k < sorted.length; k++)
              combos.push([sorted[i], sorted[j], sorted[k]]);
      }
      combos.sort(
        (a, b) => a.reduce((s2, u) => s2 + u.satoshis, 0) - b.reduce((s2, u) => s2 + u.satoshis, 0)
      );
      let lastError = "";
      for (const combo of combos) {
        const tx = new Transaction();
        tx.addInput({
          sourceTransaction: tokenSourceTx,
          sourceOutputIndex: tokenOutputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(this.key)
        });
        for (const u of combo) {
          const sourceTx = await this.provider.getSourceTransaction(u.txId);
          tx.addInput({
            sourceTransaction: sourceTx,
            sourceOutputIndex: u.outputIndex,
            unlockingScriptTemplate: new P2PKH().unlock(this.key)
          });
        }
        addOutputs(tx);
        const numInputs = 1 + combo.length;
        const fee = estimateFee(numInputs, tx.outputs.length + 1, tx.outputs, this.feePerKb);
        const totalIn = TOKEN_SATS + combo.reduce((s2, u) => s2 + u.satoshis, 0);
        const protocolOut = tx.outputs.reduce((s2, o) => s2 + (o.satoshis ?? 0), 0);
        const changeAmount = totalIn - protocolOut - fee;
        if (changeAmount < 0) {
          const fundingSats = combo.reduce((s2, u) => s2 + u.satoshis, 0);
          lastError = `${combo.length} funding UTXO(s) totalling ${fundingSats} sats too small for fees (need ${fee} sats)`;
          continue;
        }
        const changeOutputIndex = tx.outputs.length;
        tx.addOutput({
          lockingScript: new P2PKH().lock(changeAddress),
          satoshis: changeAmount
        });
        await tx.sign();
        const txId = tx.id("hex");
        const tokenTxId = tokenSourceTx.id("hex");
        return {
          tx,
          rawHex: tx.toHex(),
          txId,
          fee,
          spentInputs: [
            { txId: tokenTxId, outputIndex: tokenOutputIndex },
            ...combo.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
          ],
          changeOutput: changeAmount > 0 ? { outputIndex: changeOutputIndex, satoshis: changeAmount } : null
        };
      }
      const totalFunding = fundingUtxos.reduce((s2, u) => s2 + u.satoshis, 0);
      throw new Error(
        `Insufficient funding balance (${totalFunding} sats) to cover transfer fees. ${lastError}`
      );
    }
    /**
     * Build a funded transaction for fungible token transfers.
     *
     * TX structure:
     *   Inputs:  token UTXOs (1+) + funding UTXOs (1+)
     *   Outputs: [0] recipient P2PKH, [1] OP_RETURN, [2] token change (if any), [3] fee change
     */
    async buildFundedFungibleTransferTx(tokenSources, fundingUtxos, changeAddress, recipientAddress, amount, tokenChange, opReturnData) {
      const sorted = [...fundingUtxos].sort((a, b) => a.satoshis - b.satoshis);
      const combos = [];
      for (const u of sorted) combos.push([u]);
      if (sorted.length >= 2) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            combos.push([sorted[i], sorted[j]]);
      }
      if (sorted.length >= 3) {
        for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            for (let k = j + 1; k < sorted.length; k++)
              combos.push([sorted[i], sorted[j], sorted[k]]);
      }
      combos.sort(
        (a, b) => a.reduce((s2, u) => s2 + u.satoshis, 0) - b.reduce((s2, u) => s2 + u.satoshis, 0)
      );
      let lastError = "";
      for (const combo of combos) {
        const tx = new Transaction();
        for (const { tx: sourceTx, outputIndex } of tokenSources) {
          tx.addInput({
            sourceTransaction: sourceTx,
            sourceOutputIndex: outputIndex,
            unlockingScriptTemplate: new P2PKH().unlock(this.key)
          });
        }
        for (const u of combo) {
          const sourceTx = await this.provider.getSourceTransaction(u.txId);
          tx.addInput({
            sourceTransaction: sourceTx,
            sourceOutputIndex: u.outputIndex,
            unlockingScriptTemplate: new P2PKH().unlock(this.key)
          });
        }
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: amount
        });
        tx.addOutput({
          lockingScript: encodeOpReturn(opReturnData),
          satoshis: 0
        });
        if (tokenChange > 0) {
          tx.addOutput({
            lockingScript: new P2PKH().lock(changeAddress),
            satoshis: tokenChange
          });
        }
        const numInputs = tokenSources.length + combo.length;
        const numOutputsBeforeFeeChange = tx.outputs.length;
        const fee = estimateFee(numInputs, numOutputsBeforeFeeChange + 1, tx.outputs, this.feePerKb);
        const fundingIn = combo.reduce((s2, u) => s2 + u.satoshis, 0);
        const feeChangeAmount = fundingIn - fee;
        if (feeChangeAmount < 0) {
          lastError = `${combo.length} funding UTXO(s) totalling ${fundingIn} sats too small for fees (need ${fee} sats)`;
          continue;
        }
        const feeChangeOutputIndex = tx.outputs.length;
        tx.addOutput({
          lockingScript: new P2PKH().lock(changeAddress),
          satoshis: feeChangeAmount
        });
        await tx.sign();
        const txId = tx.id("hex");
        const spentInputs = [
          ...tokenSources.map((s2) => ({ txId: s2.tx.id("hex"), outputIndex: s2.outputIndex })),
          ...combo.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
        ];
        return {
          tx,
          rawHex: tx.toHex(),
          txId,
          fee,
          spentInputs,
          changeOutput: feeChangeAmount > 0 ? { outputIndex: feeChangeOutputIndex, satoshis: feeChangeAmount } : null
        };
      }
      const totalFunding = fundingUtxos.reduce((s2, u) => s2 + u.satoshis, 0);
      throw new Error(
        `Insufficient funding balance (${totalFunding} sats) to cover transfer fees. ${lastError}`
      );
    }
    /**
     * Recover a flushed token: change status from 'flushed' back to 'active'
     * (internal-only, no blockchain transaction)
     */
    async recoverToken(tokenId) {
      const token = await this.store.getToken(tokenId);
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      if (token.status !== "flushed") {
        throw new Error(`Token is not flushed (current status: ${token.status})`);
      }
      token.status = "active";
      token.flushedAt = void 0;
      await this.store.updateToken(token);
      console.debug(`recoverToken: restored token ${tokenId} to active status`);
      return { tokenId, status: "active" };
    }
    /**
     * Recover a flushed fungible UTXO: change status from 'flushed' back to 'active'
     * (internal-only, no blockchain transaction)
     */
    async recoverFungibleUtxo(tokenId, utxoIndex) {
      const fungible = await this.store.getFungibleToken(tokenId);
      if (!fungible) throw new Error(`Fungible token not found: ${tokenId}`);
      const utxo = fungible.utxos[utxoIndex];
      if (!utxo) throw new Error(`UTXO index out of range: ${utxoIndex}`);
      if (utxo.status !== "flushed") {
        throw new Error(`UTXO is not flushed (current status: ${utxo.status})`);
      }
      utxo.status = "active";
      utxo.flushedAt = void 0;
      await this.store.updateFungibleToken(fungible);
      console.debug(`recoverFungibleUtxo: restored UTXO ${utxoIndex} of ${tokenId} to active status`);
      return { tokenId, utxoIndex };
    }
  };
  function estimateFee(numInputs, numOutputs, existingOutputs, feePerKb) {
    let size = TX_OVERHEAD + numInputs * BYTES_PER_INPUT;
    for (const o of existingOutputs) {
      const scriptLen = o.lockingScript?.toBinary()?.length ?? 25;
      const varintLen = scriptLen < 253 ? 1 : scriptLen < 65536 ? 3 : 5;
      size += 8 + varintLen + scriptLen;
    }
    size += BYTES_PER_P2PKH_OUTPUT;
    return Math.ceil(size * feePerKb / 1e3);
  }
  function isP2pkhToAddress(scriptHex, address) {
    if (scriptHex.length !== 50) return false;
    if (!scriptHex.startsWith("76a914") || !scriptHex.endsWith("88ac")) return false;
    const scriptPkhHex = scriptHex.slice(6, 46);
    const addressPkhHex = addressToPubKeyHash(address);
    if (!addressPkhHex) {
      console.debug(`isP2pkhToAddress: addressToPubKeyHash("${address}") returned null`);
      return false;
    }
    const match = scriptPkhHex === addressPkhHex;
    if (!match) {
      console.debug(`isP2pkhToAddress: script PKH=${scriptPkhHex}, address PKH=${addressPkhHex} -- NO MATCH`);
    }
    return match;
  }
  function addressToPubKeyHash(address) {
    const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let leadingZeros = 0;
    for (const char of address) {
      if (char === "1") leadingZeros++;
      else break;
    }
    let num = BigInt(0);
    for (const char of address) {
      const idx = ALPHABET.indexOf(char);
      if (idx === -1) return null;
      num = num * BigInt(58) + BigInt(idx);
    }
    let hex = num.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    const targetLen = 50 - leadingZeros * 2;
    while (hex.length < targetLen) hex = "0" + hex;
    hex = "00".repeat(leadingZeros) + hex;
    if (hex.length !== 50) {
      console.debug(`addressToPubKeyHash: unexpected length ${hex.length} for "${address}" (leadingZeros=${leadingZeros})`);
      return null;
    }
    return hex.slice(2, 42);
  }
  function pubKeyHashToAddress(pubKeyHashHex) {
    try {
      if (pubKeyHashHex.length !== 40) return null;
      const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const versionedHash = "00" + pubKeyHashHex;
      const hexToByteArray = (hex) => {
        const bytes2 = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes2.push(parseInt(hex.substr(i, 2), 16));
        }
        return bytes2;
      };
      const versionedHashBytes = hexToByteArray(versionedHash);
      const firstSha = Hash_exports.sha256(versionedHashBytes);
      const secondSha = Hash_exports.sha256(Array.from(firstSha));
      const checksumHex = Array.from(secondSha).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
      const fullHex = versionedHash + checksumHex;
      let num = BigInt("0x" + fullHex);
      let encoded = "";
      while (num > BigInt(0)) {
        encoded = ALPHABET[Number(num % BigInt(58n))] + encoded;
        num = num / BigInt(58n);
      }
      let zeros = 0;
      for (let i = 0; i < fullHex.length; i += 2) {
        if (fullHex.substr(i, 2) === "00") zeros++;
        else break;
      }
      encoded = "1".repeat(zeros) + encoded;
      console.debug(`pubKeyHashToAddress: converted ${pubKeyHashHex.slice(0, 8)}... to ${encoded.slice(0, 8)}...`);
      return encoded || null;
    } catch (error) {
      console.debug(`pubKeyHashToAddress: error converting ${pubKeyHashHex}:`, error);
      return null;
    }
  }
  function extractAddressFromP2pkhScript(scriptHex) {
    if (scriptHex.length !== 50) {
      console.debug(`extractAddressFromP2pkhScript: script length ${scriptHex.length} != 50, cannot extract`);
      return null;
    }
    if (!scriptHex.startsWith("76a914") || !scriptHex.endsWith("88ac")) {
      console.debug(`extractAddressFromP2pkhScript: invalid P2PKH format (start=${scriptHex.slice(0, 6)}, end=${scriptHex.slice(-4)})`);
      return null;
    }
    const pubKeyHashHex = scriptHex.slice(6, 46);
    console.debug(`extractAddressFromP2pkhScript: extracted pubKeyHash ${pubKeyHashHex.slice(0, 8)}...`);
    const addr = pubKeyHashToAddress(pubKeyHashHex);
    if (!addr) {
      console.debug(`extractAddressFromP2pkhScript: pubKeyHashToAddress returned null for ${pubKeyHashHex.slice(0, 8)}...`);
    }
    return addr;
  }
  function extractCallerFromSPVEnvelope(input) {
    try {
      if (input.sourceOutput?.lockingScript) {
        const scriptHex = input.sourceOutput.lockingScript.toHex();
        const addr = extractAddressFromP2pkhScript(scriptHex);
        if (addr) {
          console.log(`[tokenBuilder] \u2705 [Method 1] CALLER from SPV envelope: ${addr}`);
          return addr;
        }
      }
    } catch (e) {
      console.debug(`[tokenBuilder] Note: SPV envelope method failed: ${e?.message}`);
    }
    return null;
  }
  async function extractCallerFromBlockchain(provider2, input) {
    try {
      if (!input.sourceTXID || input.sourceOutputIndex === void 0) return null;
      console.debug(`[tokenBuilder] \u{1F310} [Method 2] Querying blockchain for prev TX: ${input.sourceTXID.slice(0, 12)}...`);
      const prevTx = await provider2.getSourceTransaction(input.sourceTXID);
      if (prevTx.outputs?.[input.sourceOutputIndex]) {
        const prevOutput = prevTx.outputs[input.sourceOutputIndex];
        if (prevOutput.lockingScript) {
          const scriptHex = prevOutput.lockingScript.toHex();
          const addr = extractAddressFromP2pkhScript(scriptHex);
          if (addr) {
            console.log(`[tokenBuilder] \u2705 [Method 2] CALLER from blockchain: ${addr}`);
            return addr;
          }
        }
      }
    } catch (e) {
      console.warn(`[tokenBuilder] Note: Blockchain query method failed: ${e?.message}`);
    }
    return null;
  }

  // src/token_protocol/tokenStore.ts
  var LocalStorageBackend = class {
    constructor(prefix = "p:") {
      __publicField(this, "prefix");
      this.prefix = prefix;
    }
    async get(key) {
      return localStorage.getItem(this.prefix + key);
    }
    async set(key, value) {
      localStorage.setItem(this.prefix + key, value);
    }
    async delete(key) {
      localStorage.removeItem(this.prefix + key);
    }
    async keys() {
      return Object.keys(localStorage).filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
    }
  };
  var TOKEN_KEY = "token:";
  var PROOF_KEY = "proof:";
  var FUNGIBLE_KEY = "fungible:";
  var TokenStore = class {
    constructor(storage) {
      this.storage = storage;
    }
    /** Store token and its proof chain separately but with matching keys for consistent lookups. */
    async addToken(token, proofChain) {
      await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token));
      await this.storage.set(PROOF_KEY + token.tokenId, JSON.stringify(proofChain));
    }
    async getToken(tokenId) {
      const data = await this.storage.get(TOKEN_KEY + tokenId);
      if (!data) return null;
      const token = JSON.parse(data);
      if (!token.status) token.status = "active";
      if (token.status === "pending") {
        token.status = "active";
        token.confirmationStatus = "unconfirmed";
      }
      return token;
    }
    async getProofChain(tokenId) {
      const data = await this.storage.get(PROOF_KEY + tokenId);
      return data ? JSON.parse(data) : null;
    }
    async updateToken(token) {
      await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token));
    }
    async removeToken(tokenId) {
      await this.storage.delete(TOKEN_KEY + tokenId);
      await this.storage.delete(PROOF_KEY + tokenId);
    }
    async listTokens() {
      const allKeys = await this.storage.keys();
      const tokens = [];
      for (const key of allKeys) {
        if (key.startsWith(TOKEN_KEY)) {
          const data = await this.storage.get(key);
          if (data) {
            const token = JSON.parse(data);
            if (!token.status) token.status = "active";
            if (token.status === "pending") {
              token.status = "active";
              token.confirmationStatus = "unconfirmed";
            }
            tokens.push(token);
          }
        }
      }
      return tokens;
    }
    async findToken(idOrTxId) {
      const direct = await this.getToken(idOrTxId);
      if (direct) return direct;
      const all = await this.listTokens();
      return all.find(
        (t) => t.genesisTxId === idOrTxId || t.currentTxId === idOrTxId
      ) ?? null;
    }
    // ─── Fungible Token Methods ──────────────────────────────────────
    async addFungibleToken(token, proofChain) {
      await this.storage.set(FUNGIBLE_KEY + token.tokenId, JSON.stringify(token));
      await this.storage.set(PROOF_KEY + token.tokenId, JSON.stringify(proofChain));
    }
    async getFungibleToken(tokenId) {
      const data = await this.storage.get(FUNGIBLE_KEY + tokenId);
      return data ? JSON.parse(data) : null;
    }
    async updateFungibleToken(token) {
      await this.storage.set(FUNGIBLE_KEY + token.tokenId, JSON.stringify(token));
    }
    async listFungibleTokens() {
      const allKeys = await this.storage.keys();
      const tokens = [];
      for (const key of allKeys) {
        if (key.startsWith(FUNGIBLE_KEY)) {
          const data = await this.storage.get(key);
          if (data) tokens.push(JSON.parse(data));
        }
      }
      return tokens;
    }
    /** Get total balance of a fungible token (sum of active UTXOs) */
    async getFungibleBalance(tokenId) {
      const token = await this.getFungibleToken(tokenId);
      if (!token) return 0;
      return token.utxos.filter((u) => u.status === "active").reduce((sum, u) => sum + u.satoshis, 0);
    }
  };

  // src/app.ts
  var provider;
  var builder;
  var store;
  var WIF_KEY = "p:wallet:wif";
  function init() {
    let wif = localStorage.getItem(WIF_KEY);
    let key;
    if (wif) {
      try {
        key = PrivateKey.fromWif(wif);
      } catch {
        key = PrivateKey.fromRandom();
        localStorage.setItem(WIF_KEY, key.toWif());
      }
    } else {
      key = PrivateKey.fromRandom();
      wif = key.toWif();
      localStorage.setItem(WIF_KEY, wif);
    }
    const address = key.toAddress();
    provider = new WalletProvider(address);
    const storage = new LocalStorageBackend("p:data:");
    store = new TokenStore(storage);
    builder = new TokenBuilder(provider, store, key);
    console.log("[SVphone v06.12] Initialized");
    console.log("[SVphone v06.12] Address:", address);
    console.log("[SVphone v06.12] TokenBuilder available:", !!builder);
  }
  window.TokenBuilder = TokenBuilder;
  window.TokenStore = TokenStore;
  window.WalletProvider = WalletProvider;
  window.initWallet = init;
  function initAndExpose() {
    init();
    window.builder = builder;
    window.tokenBuilder = builder;
    window.store = store;
    window.provider = provider;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAndExpose);
  } else {
    initAndExpose();
  }
})();
//# sourceMappingURL=bundle.js.map
