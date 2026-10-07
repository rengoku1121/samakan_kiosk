# VMC protocol (Tahap 1)

Protokol byte kiosk ↔ VMC. **Penjelasan lengkap (dari nol, file-per-file, alur):** lihat [`../README.md`](../README.md).

Sumber PDF: `VMC-Upper computer_V3.0_0411.pdf` — baud **57600 8N1**, VMC = host (POLL).

## File singkat

| File | Guna |
|------|------|
| `index.ts` | Export publik |
| `types.ts` | Tipe data |
| `constants.ts` | Baud, CMD, status |
| `selection.ts` | `"013"` → 2 byte |
| `frame.ts` | Bungkus/buka `FA FB…` + XOR |
| `commands.ts` | Build ACK / drive `0x06` / dll |
| `status.ts` | Parse status dispense `0x04` |
| `vmc-protocol.spec.ts` | Unit test |

```ts
import { buildDriveSelectionFrame, bytesToHex } from '../hardware/vmc';

const frame = buildDriveSelectionFrame({
  packNo: 1,
  slotCode: '013',
  heatRequested: true,
});
console.log(bytesToHex(frame));
```
