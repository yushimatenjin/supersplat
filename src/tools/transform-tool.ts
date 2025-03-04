import { TransformGizmo, Vec3 } from 'playcanvas';
import { Scene } from '../scene';
import { Splat } from '../splat';
import { Events } from '../events';
import { EditHistory } from '../edit-history';
import { EntityOp, EntityTransformOp } from '../edit-ops';

// patch gizmo to be more opaque
const patchGizmoMaterials = (gizmo: TransformGizmo) => {
    // @ts-ignore
    ['x', 'y', 'z', 'xyz', 'face'].forEach(name => { gizmo._meshColors.axis[name].a = 0.8; });
    // @ts-ignore
    gizmo._meshColors.disabled.a = 0.8;
};

class SetPivotOp {
    name = "setPivot";
    splat: Splat;
    oldPivot: Vec3;
    newPivot: Vec3;

    constructor(splat: Splat, oldPivot: Vec3, newPivot: Vec3) {
        this.splat = splat;
        this.oldPivot = oldPivot;
        this.newPivot = newPivot;
    }

    do() {
        this.splat.setPivot(this.newPivot);
    }

    undo() {
        this.splat.setPivot(this.oldPivot);
    }
}

class TransformTool {
    scene: Scene;
    gizmo: TransformGizmo;
    splats: Splat[] = [];
    ops: EntityOp[] = [];
    events: Events;
    active = false;

    constructor(gizmo: TransformGizmo, events: Events, editHistory: EditHistory, scene: Scene) {
        this.scene = scene;
        this.gizmo = gizmo;
        this.events = events;

        // patch gizmo materials (until we have API to do this)
        patchGizmoMaterials(this.gizmo);

        this.gizmo.coordSpace = events.invoke('tool.coordSpace');

        this.gizmo.on('render:update', () => {
            scene.forceRender = true;
        });

        this.gizmo.on('transform:start', () => {
            this.ops = this.splats.map((splat) => {
                const pivot = splat.pivot;

                return {
                    splat,
                    old: {
                        position: pivot.getLocalPosition().clone(),
                        rotation: pivot.getLocalRotation().clone(),
                        scale: pivot.getLocalScale().clone()
                    },
                    new: {
                        position: pivot.getLocalPosition().clone(),
                        rotation: pivot.getLocalRotation().clone(),
                        scale: pivot.getLocalScale().clone()
                    }
                }
            });
        });

        this.gizmo.on('transform:move', () => {
            this.ops.forEach((op) => {
                op.splat.worldBoundDirty = true;
            });
            scene.boundDirty = true;
        });

        this.gizmo.on('transform:end', () => {
            // update new transforms
            this.ops.forEach((op) => {
                const e = op.splat.pivot;
                op.new.position.copy(e.getLocalPosition());
                op.new.rotation.copy(e.getLocalRotation());
                op.new.scale.copy(e.getLocalScale());
            });

            // filter out ops that didn't change
            this.ops = this.ops.filter((op) => {
                const e = op.splat.pivot;
                return !op.old.position.equals(e.getLocalPosition()) ||
                       !op.old.rotation.equals(e.getLocalRotation()) ||
                       !op.old.scale.equals(e.getLocalScale());
            });

            if (this.ops.length > 0) {
                editHistory.add(new EntityTransformOp(this.ops));
                this.ops = [];
            }
        });

        events.on('scene.boundChanged', () => {
            if (this.splats) {
                this.gizmo.attach(this.splats.map((splat) => splat.pivot));
            }
        });

        events.on('tool.coordSpace', (coordSpace: string) => {
            this.gizmo.coordSpace = coordSpace;
            scene.forceRender = true;
        });

        events.on('selection.changed', () => {
            this.update();
        });

        events.on('splat.moved', (splat: Splat) => {
            this.update();
        });

        const updateGizmoSize = () => {
            const canvas = document.getElementById('canvas');
            if (canvas) {
                const w = canvas.clientWidth;
                const h = canvas.clientHeight;
                this.gizmo.size = 1200 / Math.max(w, h);

                // FIXME:
                // this is a temporary workaround to undo gizmo's own auto scaling.
                // once gizmo's autoscaling code is removed, this line can go too.
                // @ts-ignore
                this.gizmo._deviceStartSize = Math.min(scene.app.graphicsDevice.width, scene.app.graphicsDevice.height);
            }
        };

        events.on('camera.resize', () => {
            this.scene.events.on('camera.resize', updateGizmoSize);
        });

        events.on('camera.focalPointPicked', (details: { splat: Splat, position: Vec3 }) => {
            if (this.active) {
                const op = new SetPivotOp(details.splat, details.splat.pivot.getLocalPosition().clone(), details.position.clone());
                editHistory.add(op);
            }
        });

        updateGizmoSize();
    }

    update() {
        if (!this.active) {
            this.gizmo.detach();
            this.splats = [];
            return;
        }

        const selection = this.events.invoke('selection') as Splat;
        if (!selection) {
            this.gizmo.detach();
            this.splats = [];
            return;
        }

        this.splats = [ selection ];
        this.gizmo.attach(this.splats.map((splats) => splats.pivot));
    }

    activate() {
        this.active = true;
        this.update();
    }

    deactivate() {
        this.active = false;
        this.update();
    }
}

export { TransformTool };
