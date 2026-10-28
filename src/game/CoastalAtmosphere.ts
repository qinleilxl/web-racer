import * as T from "three";

/** Shared coast lighting and atmosphere for the homepage and the race. */
export class CoastalAtmosphere {
  readonly sun: T.DirectionalLight;
  private clouds = new T.Group();
  private water: T.ShaderMaterial;
  constructor(scene: T.Scene, testGround = false) {
    scene.background = new T.Color("#c1e0e5");
    scene.fog = new T.FogExp2(
      "#c7e0df",
      testGround ? 0.00085 : 0.00135,
    );
    scene.add(new T.HemisphereLight("#e4f4fc", "#a9ad78", 2.3));
    this.sun = new T.DirectionalLight("#fff0cf", 3.1);
    this.sun.position.set(-60, 120, 70);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -55;
    this.sun.shadow.camera.right = 55;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    const sky = new T.Mesh(
      new T.SphereGeometry(1800, 24, 16),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new T.Color("#76bdcf") },
          bottom: { value: new T.Color("#e9eedb") },
        },
        vertexShader:
          "varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec3 vPosition;uniform vec3 top;uniform vec3 bottom;void main(){float h=clamp(normalize(vPosition).y*1.6,0.,1.);gl_FragColor=vec4(mix(bottom,top,pow(h,.65)),1.);}",
      }),
    );
    scene.add(sky);
    const cloudMat = new T.MeshStandardMaterial({
      color: "#fff9e7",
      roughness: 1,
    });
    const cloudGeo = new T.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 20; i++) {
      const cluster = new T.Group();
      const angle = (i / 20) * Math.PI * 2;
      cluster.position.set(
        Math.cos(angle) * (560 + (i % 3) * 150),
        120 + (i % 5) * 22,
        Math.sin(angle) * (560 + (i % 3) * 150),
      );
      for (let j = 0; j < 7; j++) {
        const puff = new T.Mesh(cloudGeo, cloudMat);
        puff.position.set(
          (j - 3) * 19,
          Math.sin(j * 2.3 + i) * 8,
          Math.cos(j * 3) * 10,
        );
        puff.scale.set(25 + (j % 3) * 7, 12 + (j % 3) * 6, 17 + (j % 2) * 8);
        cluster.add(puff);
      }
      this.clouds.add(cluster);
    }
    scene.add(this.clouds);
    this.water = new T.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader:
        "varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 world;uniform float time;void main(){float a=sin(world.x*.19+world.z*.31+time*.7);float b=sin(world.x*.07-world.z*.14+time*.45);float c=pow(max(0.,a*b),12.);float stripe=sin(world.x*.025+world.z*.04);vec3 color=mix(vec3(.18,.58,.64),vec3(.34,.71,.73),.5+.5*stripe);color+=c*.2;float fog=1.-exp(-.0000015*dot(world.xz-cameraPosition.xz,world.xz-cameraPosition.xz));gl_FragColor=vec4(mix(color,vec3(.74,.85,.81),fog),1.);}`,
    });
    const ocean = new T.Mesh(new T.PlaneGeometry(8000, 8000), this.water);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = testGround ? -1 : -0.03;
    scene.add(ocean);
  }
  update(time: number, car: T.Vector3) {
    this.water.uniforms.time.value = time;
    this.clouds.rotation.y = time * 0.0008;
    this.sun.target.position.copy(car);
    this.sun.position.copy(car).add(new T.Vector3(-60, 120, 70));
  }
}
