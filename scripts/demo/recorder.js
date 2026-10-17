// デモ動画の録画処理(stage.js / concept.js で共有)。台本のページが自分自身の画面を取り込んで録画する。
const log = (message) => window.demoBridge?.log(message);

// この環境のH.264書き出しは1080pで毎秒27枚ほどが限界で、30にすると遅れがたまって末尾が欠けるため24にする
const OUTPUT_FPS = 24;

// 出力は画面(1280x720)の1.5倍の1920x1080。縦長版はページを90度回して横長の画面に描いているので、
// 書き出すときに回転を戻して1080x1920にする(ディスプレイの高さが足りなくても縦長を録画できるようにするため)
window.startRecording = async function startRecording() {
  const rotated = document.documentElement.classList.contains("rotated");
  // ウィンドウの内寸は環境によって数px ぶれるため、出力の大きさは固定する
  const captureWidth = 1920;
  const captureHeight = 1080;
  // 大きさを指定しないとディスプレイの大きさに合わせて縮められるため、出力と同じ大きさで取り込む
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: captureWidth }, height: { max: captureHeight }, frameRate: OUTPUT_FPS },
    audio: false,
  });
  const captureTrack = stream.getVideoTracks()[0];
  const { width, height } = captureTrack.getSettings();

  const canvas = document.createElement("canvas");
  canvas.width = rotated ? captureHeight : captureWidth;
  canvas.height = rotated ? captureWidth : captureHeight;
  log(`capture ${width}x${height} -> ${canvas.width}x${canvas.height}`);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  if (rotated) {
    // ページは-90度回して描いてあるので、+90度回して元の向きに戻す
    context.setTransform(0, 1, -1, 0, canvas.width, 0);
  }
  const output = canvas.captureStream(0);
  const outputTrack = output.getVideoTracks()[0];

  // キャプチャのフレームを直接受け取って描く。
  // (video要素経由だと、画面に表示していない要素のフレーム通知が間引かれ、数秒ぶんコマが抜けることがあった)
  const reader = new MediaStreamTrackProcessor({ track: captureTrack }).readable.getReader();
  let drawing = true;
  let firstFrameDrawn;
  const firstFrame = new Promise((resolve) => (firstFrameDrawn = resolve));
  const readFrames = (async () => {
    while (drawing) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      context.drawImage(frame, 0, 0, captureWidth, captureHeight);
      frame.close();
      firstFrameDrawn();
    }
  })();
  // 最初のフレームが描けるまでは録画しない(先に始めると冒頭が黒くなる)
  await firstFrame;

  // CSSのフェードはコンポジタだけで描かれるため、キャプチャが「画面が変わった」と見なさずフレームを送ってこないことがある。
  // 見えない1px要素を毎フレーム描き換えて、常に新しいフレームが届くようにする
  const pulse = document.createElement("div");
  pulse.style.cssText = "position: fixed; left: 0; top: 0; width: 1px; height: 1px; z-index: 2147483647; pointer-events: none;";
  document.documentElement.append(pulse);
  let pulseOn = false;
  const pulseFrame = () => {
    if (!drawing) return;
    pulseOn = !pulseOn;
    pulse.style.background = pulseOn ? "rgba(0, 0, 0, 0.004)" : "rgba(0, 0, 0, 0.003)";
    requestAnimationFrame(pulseFrame);
  };
  requestAnimationFrame(pulseFrame);

  // 書き出しは一定間隔で行う(キャンバスに透明な点を描いて更新扱いにしないと、同じ絵のフレームは書き出されない)
  const tick = setInterval(() => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "rgba(0, 0, 0, 0)";
    context.fillRect(0, 0, 1, 1);
    context.restore();
    outputTrack.requestFrame();
  }, 1000 / OUTPUT_FPS);

  // 1080pのVP9はCPUでは書き出しが追いつかず末尾が欠けるため、ハードウェアで処理しやすいH.264を使う。
  // 展示会場のプレーヤーでも再生しやすいよう、入れ物はMP4にする
  const recorder = new MediaRecorder(output, { mimeType: "video/mp4;codecs=avc1.640028", videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
  // エンコーダーの立ち上がりで最初の1秒ほどが抜けるため、録画を始めてから少し待ってから台本を進める
  recorder.start(1000);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return async () => {
    // 停止直前のフレームが書き出される前に止まらないよう、少し余白を録ってから止める
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.stop();
    await stopped;
    clearInterval(tick);
    drawing = false;
    pulse.remove();
    stream.getTracks().forEach((track) => track.stop());
    await readFrames.catch(() => {});
    const blob = new Blob(chunks, { type: "video/mp4" });
    await window.demoBridge.save(new Uint8Array(await blob.arrayBuffer()));
  };
};
