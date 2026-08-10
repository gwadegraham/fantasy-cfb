"""Minimal dependency-free PNG read/write for 8-bit RGB/RGBA/grey."""
import zlib, struct


def read_png(path):
    """-> (width, height, [[(r,g,b,a), ...], ...])"""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat, pal, trns = 8, bytearray(), None, None
    w = h = depth = ctype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if tag == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8, f'unsupported bit depth {depth}'
            assert interlace == 0, 'interlaced PNG unsupported'
        elif tag == b'PLTE':
            pal = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif tag == b'tRNS':
            trns = body
        elif tag == b'IDAT':
            idat += body
        elif tag == b'IEND':
            break
        pos += 12 + ln

    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(bytes(idat))
    stride = w * nch
    prev = bytearray(stride)
    rows = []
    p = 0
    for _ in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ft == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                c = prev[i - nch] if i >= nch else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ft != 0:
            raise ValueError(f'bad filter {ft}')

        out = []
        for x in range(w):
            o = x * nch
            if ctype == 6:
                out.append((line[o], line[o + 1], line[o + 2], line[o + 3]))
            elif ctype == 2:
                out.append((line[o], line[o + 1], line[o + 2], 255))
            elif ctype == 0:
                v = line[o]; out.append((v, v, v, 255))
            elif ctype == 4:
                v = line[o]; out.append((v, v, v, line[o + 1]))
            else:
                c = pal[line[o]]
                a = trns[line[o]] if trns and line[o] < len(trns) else 255
                out.append((c[0], c[1], c[2], a))
        rows.append(out)
        prev = line
    return w, h, rows


def write_png(path, rows):
    h = len(rows); w = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for px in row:
            raw += bytes((px[0], px[1], px[2], px[3] if len(px) > 3 else 255))

    def chunk(tag, body):
        return (struct.pack('>I', len(body)) + tag + body
                + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF))

    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
        + chunk(b'IEND', b''))
