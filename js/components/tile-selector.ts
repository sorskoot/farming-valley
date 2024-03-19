import { Component, Object3D } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';
import { quat, vec3 } from 'gl-matrix';

const tempOrigin = vec3.create();
const tempRotation = quat.create();

export class TileSelector extends Component {
    static TypeName = 'tile-selector';

    @property.object({ required: true })
    cursorObject!: Object3D;

    @property.float(5)
    maxDistance = 5;

    @property.int(2)
    collisionGroup=2;

    init() {}

    start() {}

    update(dt: number) {
        tempRotation[0] = 0;
        tempRotation[1] = 0;
        tempRotation[2] = -1.0;
        this.object.transformVectorWorld(tempRotation, tempRotation);
        this.object.getPositionWorld(tempOrigin);

        const rayHit = this.engine.physics?.rayCast(
            tempOrigin,
            tempRotation,
            this.collisionGroup,
            this.maxDistance
        );

        if(rayHit?.hitCount) {
            const locations = rayHit.getLocations();
            locations[0][1] = 0.01;
            // snap to grid
            locations[0][0] = Math.floor(locations[0][0]+.5);
            locations[0][2] = Math.floor(locations[0][2]+.5);

            this.cursorObject.setPositionWorld(locations[0]);
        }
    }
}
