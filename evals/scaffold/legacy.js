import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#d8d8d8");
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1, 3);
const controls = new OrbitControls(camera, renderer.domElement);
const clock = new THREE.Clock();

const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(2, 3, 1);
light.castShadow = true;
scene.add(light);

new GLTFLoader().load("./MODEL", (gltf) => {
	gltf.scene.traverse((child) => {
		if (child.isMesh && child.material.map) child.material.map.encoding = THREE.sRGBEncoding;
	});
	scene.add(gltf.scene);
});

function animate() {
	requestAnimationFrame(animate);
	const delta = clock.getDelta();
	controls.update(delta);
	renderer.render(scene, camera);
}
animate();
