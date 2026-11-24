// PNG payloads are already compressed. A stored ZIP keeps export entirely local.
const crcTable = Uint32Array.from({length:256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  return {bytes, u16:(i,n)=>view.setUint16(i,n,true), u32:(i,n)=>view.setUint32(i,n,true)};
}

export async function makeZip(files) {
  const local = [], central = [];
  let offset=0, centralLength=0;
  const now = new Date();
  const date = (Math.max(0,now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
  const time = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  for (const {name,blob} of files) {
    const nameBytes=new TextEncoder().encode(name), data=new Uint8Array(await blob.arrayBuffer());
    const checksum=crc32(data), size=data.length;
    const entry=header(30);
    entry.u32(0,0x04034b50);entry.u16(4,20);entry.u16(6,0x800);
    entry.u16(10,time);entry.u16(12,date);entry.u32(14,checksum);
    entry.u32(18,size);entry.u32(22,size);entry.u16(26,nameBytes.length);
    local.push(entry.bytes,nameBytes,blob);
    const dir=header(46);
    dir.u32(0,0x02014b50);dir.u16(4,20);dir.u16(6,20);dir.u16(8,0x800);
    dir.u16(12,time);dir.u16(14,date);dir.u32(16,checksum);
    dir.u32(20,size);dir.u32(24,size);dir.u16(28,nameBytes.length);dir.u32(42,offset);
    central.push(dir.bytes,nameBytes);
    offset+=30+nameBytes.length+size;
    centralLength+=46+nameBytes.length;
  }
  const end=header(22);
  end.u32(0,0x06054b50);end.u16(8,files.length);end.u16(10,files.length);
  end.u32(12,centralLength);end.u32(16,offset);
  return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}
