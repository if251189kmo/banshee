// Порядок нативних модулів (.claude/logic/01-architecture.md, крок 0.8): обидва пакети везуть
// onnxruntime.dll з однією назвою — 1.30 і 1.28. Першим має завантажитись onnxruntime-node:
// старіша DLL першою — і він падає з помилкою Windows 182. Модулі зі sherpa-onnx-node імпортують
// цей файл першим рядком.
import 'onnxruntime-node';
