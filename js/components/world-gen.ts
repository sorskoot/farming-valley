import { Component, Object3D } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';

export class WorldGen extends Component {
    static TypeName = 'world-gen';

    @property.object({required:true})
    grassTile!:Object3D;

    init() {
    }

    start() {
        for (let i = -25; i < 25; i++) {
            for (let j = -25; j < 25; j++) {
                const tile = this.grassTile.clone(this.object);
                tile.setPositionWorld([i, 0, j]);
            }
        }
    }

    update(dt:number) {
    }

}