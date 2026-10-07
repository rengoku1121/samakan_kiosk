import {
  buildAckFrame,
  buildCheckSelectionFrame,
  buildCheckSelectionResultFrame,
  buildDriveSelectionFrame,
  buildFrame,
  buildJammedClearReplyFrame,
  buildJammedQueryReplyFrame,
  buildJammedSelectionFrame,
  buildRequestMachineStatusFrame,
  buildSelectToBuyFrame,
  bytesToHex,
  CheckSelectionResultCode,
  DispenseStatus,
  hexToBytes,
  isJammedSelectionReply,
  isTerminalSuccessStatus,
  JammedSelectionMenu,
  parseCheckSelectionResult,
  parseDispenseStatusFrame,
  parseJammedClearReply,
  parseJammedQueryReply,
  parseFrames,
  tryParseFrameAt,
  VmcCmd,
  xorBytes,
} from './index';

describe('VMC protocol (tahap 1)', () => {
  it('builds POLL/ACK XOR seperti contoh PDF', () => {
    expect(xorBytes([0xfa, 0xfb, 0x41, 0x00])).toBe(0x40);
    expect(xorBytes([0xfa, 0xfb, 0x42, 0x00])).toBe(0x43);
    expect(bytesToHex(buildAckFrame())).toBe('FA FB 42 00 43');
  });

  it('builds 4.3.5 drive selection for slot 013 + heat', () => {
    const frame = buildDriveSelectionFrame({
      packNo: 1,
      slotCode: '013',
      heatRequested: true,
      enableDropSensor: true,
    });
    // FA FB 06 05 01 01 01 00 0D 0E
    expect(bytesToHex(frame)).toBe('FA FB 06 05 01 01 01 00 0D 0E');
  });

  it('builds 4.3.5 drive selection without heat (elevator=0)', () => {
    const frame = buildDriveSelectionFrame({
      packNo: 1,
      slotCode: '013',
      heatRequested: false,
    });
    expect(bytesToHex(frame)).toBe('FA FB 06 05 01 01 00 00 0D 0F');
  });

  it('builds 4.3.2 select to buy for slot 013', () => {
    const frame = buildSelectToBuyFrame({ packNo: 1, slotCode: 13 });
    expect(bytesToHex(frame)).toBe('FA FB 03 03 01 00 0D 0D');
  });

  it('builds and parses 4.3.1 check selection', () => {
    const req = buildCheckSelectionFrame(1, '013');
    expect(bytesToHex(req)).toBe('FA FB 01 04 01 00 0D 00 08');

    const ok = buildCheckSelectionResultFrame({
      packNo: 1,
      result: CheckSelectionResultCode.OK,
      slotCode: '013',
    });
    const parsedOk = parseCheckSelectionResult(tryParseFrameAt(ok)!);
    expect(parsedOk?.ok).toBe(true);
    expect(parsedOk?.result).toBe(0x01);
    expect(parsedOk?.selectionNumber).toBe(13);

    const fail = buildCheckSelectionResultFrame({
      packNo: 1,
      result: CheckSelectionResultCode.SELECTION_NOT_EXIST,
      slotCode: '004',
    });
    const parsedFail = parseCheckSelectionResult(tryParseFrameAt(fail)!);
    expect(parsedFail?.ok).toBe(false);
    expect(parsedFail?.statusLabel.toLowerCase()).toContain('tidak ada');
  });

  it('builds request machine status 0x53', () => {
    expect(bytesToHex(buildRequestMachineStatusFrame(1))).toBe('FA FB 53 01 01 52');
    expect(tryParseFrameAt(buildRequestMachineStatusFrame(7))?.cmd).toBe(
      VmcCmd.REQUEST_MACHINE_STATUS
    );
  });

  describe('4.5.32 clear jammed selection (0x70 / 0x71)', () => {
    const replyFrame = (payload: number[]) => tryParseFrameAt(buildFrame(VmcCmd.MENU_REPLY, payload))!;

    it('builds tanya dan clear sesuai PDF', () => {
      expect(bytesToHex(buildJammedSelectionFrame(1, 'query'))).toBe('FA FB 70 03 01 32 00 41');
      expect(bytesToHex(buildJammedSelectionFrame(1, 'clear'))).toBe('FA FB 70 03 01 32 01 40');
    });

    it('parses daftar jammed + belt gagal self-test', () => {
      const raw = buildJammedQueryReplyFrame({ packNo: 3, jammed: [1, 21], beltFailed: [5] });
      expect(bytesToHex(raw)).toContain('71 0B 03 32 00 02 00 01 00 15 01 00 05');

      const parsed = parseJammedQueryReply(tryParseFrameAt(raw)!);
      expect(parsed).toEqual({ packNo: 3, jammed: [1, 21], beltFailed: [5] });
    });

    it('menerima reply tanpa bagian belt', () => {
      const parsed = parseJammedQueryReply(replyFrame([0x01, 0x32, 0x00, 0x01, 0x00, 0x0d]));
      expect(parsed).toEqual({ packNo: 1, jammed: [13], beltFailed: [] });
    });

    it('menolak jumlah yang melebihi payload, tipe lain, atau operasi lain', () => {
      expect(parseJammedQueryReply(replyFrame([0x01, 0x32, 0x00, 0x02, 0x00, 0x0d]))).toBeNull();
      expect(parseJammedQueryReply(replyFrame([0x01, 0x27, 0x00, 0x00, 0x00]))).toBeNull();
      expect(parseJammedQueryReply(replyFrame([0x01, 0x32, 0x01, 0x00]))).toBeNull();
      expect(parseJammedClearReply(replyFrame([0x01, 0x32, 0x00, 0x00, 0x00]))).toBeNull();
    });

    it('parses status clear: 0x00 berhasil, 0x01 gagal', () => {
      const ok = tryParseFrameAt(buildJammedClearReplyFrame({ packNo: 2, ok: true }))!;
      const fail = tryParseFrameAt(buildJammedClearReplyFrame({ packNo: 2, ok: false }))!;
      expect(bytesToHex(ok.payload)).toBe('02 32 01 00');
      expect(parseJammedClearReply(ok)).toEqual({ packNo: 2, ok: true });
      expect(parseJammedClearReply(fail)).toEqual({ packNo: 2, ok: false });
      expect(parseJammedClearReply(replyFrame([0x02, 0x32, 0x01]))).toBeNull();
    });

    it('isJammedSelectionReply hanya cocok dengan 0x71 tipe 0x32 + operasi yang diminta', () => {
      const query = replyFrame([0x01, 0x32, 0x00, 0x00]);
      expect(isJammedSelectionReply(query, JammedSelectionMenu.QUERY)).toBeTrue();
      expect(isJammedSelectionReply(query, JammedSelectionMenu.CLEAR)).toBeFalse();
      expect(
        isJammedSelectionReply(tryParseFrameAt(buildJammedSelectionFrame(1, 'query'))!, 0x00)
      ).toBeFalse();
    });
  });

  it('round-trips parseFrames', () => {
    const a = buildDriveSelectionFrame({
      packNo: 2,
      slotCode: '001',
      heatRequested: true,
    });
    const { frames, rest } = parseFrames(a);
    expect(rest.length).toBe(0);
    expect(frames.length).toBe(1);
    expect(frames[0].cmd).toBe(VmcCmd.DRIVE_SELECTION);
    expect(tryParseFrameAt(a)?.cmd).toBe(VmcCmd.DRIVE_SELECTION);
  });

  it('parses dispense status 0x04 success', () => {
    // PackNO=01 Status=02 sel=013 mw=00
    const payload = [0x01, 0x02, 0x00, 0x0d, 0x00];
    const raw = new Uint8Array(4 + payload.length + 1);
    raw[0] = 0xfa;
    raw[1] = 0xfb;
    raw[2] = VmcCmd.DISPENSE_STATUS;
    raw[3] = payload.length;
    payload.forEach((b, i) => (raw[4 + i] = b));
    raw[4 + payload.length] = xorBytes(raw.subarray(0, 4 + payload.length));

    const frame = tryParseFrameAt(raw);
    expect(frame).toBeTruthy();
    const st = parseDispenseStatusFrame(frame!);
    expect(st?.isSuccess).toBe(true);
    expect(st?.selectionNumber).toBe(13);
    expect(st?.statusLabel).toContain('successfully');
  });

  it('heat: SUCCESS early is not terminal until heating seen', () => {
    expect(
      isTerminalSuccessStatus(DispenseStatus.SUCCESS, {
        heatRequested: true,
        seenHeating: false,
      })
    ).toBe(false);
    expect(
      isTerminalSuccessStatus(DispenseStatus.SUCCESS, {
        heatRequested: true,
        seenHeating: true,
      })
    ).toBe(true);
    expect(
      isTerminalSuccessStatus(DispenseStatus.TAKE_LUNCH_BOX, {
        heatRequested: true,
        seenHeating: false,
      })
    ).toBe(true);
  });

  it('hex helper', () => {
    expect(bytesToHex(hexToBytes('FA FB 42 00 43'))).toBe('FA FB 42 00 43');
  });
});
