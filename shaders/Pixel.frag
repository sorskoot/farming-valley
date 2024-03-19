#include "lib/Compatibility.frag"

#define USE_LIGHTS

#define FEATURE_WITH_FOG
#define FEATURE_TEXTURED
#define FEATURE_ALPHA_MASKED
#define FEATURE_NORMAL_MAPPING
#define FEATURE_VERTEX_COLORS
#define FEATURE_WITH_EMISSIVE
#define FEATURE_LIGHTMAP
#define FEATURE_GLOBAL_ILLUMINATION
#define FEATURE_TONEMAPPING
#define FEATURE_SHADOW_NORMAL_OFFSET_SCALE_BY_SHADOW_DEPTH
#define FEATURE_SHADOW_NORMAL_OFFSET_UV_ONLY
#define FEATURE_SHADOW_NORMAL_OFFSET_SLOPE_SCALE
#define FEATURE_DEPRECATED_LIGHT_ATTENUATION

#ifdef NORMAL_MAPPING
#define TEXTURED
#endif

#define USE_NORMAL
#define USE_MATERIAL_ID
#ifdef TEXTURED
#define USE_TEXTURE_COORDS
#endif
#ifdef NORMAL_MAPPING
#define USE_TANGENT
#endif

#ifdef LIGHTMAP
#define USE_TEXTURE_COORDS_1
#endif

#ifdef VERTEX_COLORS
#define USE_COLOR
#endif

#if NUM_LIGHTS > 0
#define USE_POSITION_WORLD
#endif

#if NUM_SHADOWS > 0
#define USE_POSITION_VIEW
#endif

#include "lib/Uniforms.glsl"
#include "lib/Inputs.frag"
#include "lib/Math.glsl"

#if NUM_LIGHTS > 0
#include "lib/Quaternion.glsl"
#include "lib/Lights.frag"
#endif

#ifdef TEXTURED
#include "lib/Textures.frag"
#endif
#include "lib/Surface.frag"
#include "lib/Packing.frag"
#include "lib/Materials.frag"

#ifdef GLOBAL_ILLUMINATION
#include "lib/CoordinateSystems.glsl"
#include "lib/GI.frag"
#endif

#ifdef TONEMAPPING
#include "lib/Color.glsl"
#endif

struct Material {
    mediump vec2 pixelSize;
    mediump vec2 resolution;
    lowp vec4 ambientColor;
    lowp vec4 diffuseColor;
    lowp vec4 specularColor;
#ifdef WITH_EMISSIVE
    lowp vec4 emissiveColor;
#endif

#ifdef WITH_FOG
    lowp vec4 fogColor;
#endif

#ifdef TEXTURED
    mediump uint diffuseTexture;
#ifdef WITH_EMISSIVE
    mediump uint emissiveTexture;
#endif
#ifdef NORMAL_MAPPING
    mediump uint normalTexture;
#endif
mediump float blurSize;
#ifdef LIGHTMAP
    mediump uint lightmapTexture;
    
    lowp float lightmapFactor;
#endif
#endif
    lowp uint shininess;
    
};

Material decodeMaterial(uint matIndex) {
    {{decoder}}
    return mat;
}

#ifdef WITH_FOG
float fogFactorExp2(float dist, float density) {
    const float LOG2 = -1.442695;
    float d = density * dist;
    return 1.0 - clamp(exp2(d*d*LOG2), 0.0, 1.0);
}
#endif

mediump float phongDiffuseBrdf(mediump vec3 lightDir, mediump vec3 normal) {
    return max(0.0, dot(lightDir, normal));
}

mediump float phongSpecularBrdf(mediump vec3 lightDir, mediump vec3 normal, mediump vec3 viewDir, mediump float shininess) {
    mediump vec3 reflection = reflect(lightDir, normal);
    return pow(max(dot(viewDir, reflection), 0.0), shininess);
}

// Function to create noise
float noise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

// Function to perform box blur
vec4 boxBlur(vec2 uv, Material mat) {
    
     vec2 pixelSize = 1.0 / mat.resolution; // The size of a single pixel
     vec4 colorSum = textureAtlas(mat.diffuseTexture, uv); // Start with the original pixel color
    
    
    float count = 0.0;
 
    // Sample surrounding pixels
    for (int x = -1; x <= 1; ++x) {
        for (int y = -1; y <= 1; ++y) {
            vec2 offset = vec2(x, y) * pixelSize * mat.blurSize;
            colorSum += textureAtlas(mat.diffuseTexture, uv + offset);
    
            count++;
        }
    }

    // Divide by the total number of samples to get the average
    return colorSum / count;
}

void main() {
    #ifdef TEXTURED
    alphaMask(fragMaterialId, fragTextureCoords);
    #endif

    Material mat = decodeMaterial(fragMaterialId);

    vec2 uv = fragTextureCoords * mat.pixelSize;
    vec2 centerUV = (floor(uv) + 0.5) / mat.pixelSize;
    
    lowp vec4 finalDiffuseColor =
        #ifdef VERTEX_COLORS
        fragColor*
        #endif
        #ifdef TEXTURED
        textureAtlas(mat.diffuseTexture, centerUV)*
        #endif
        mat.diffuseColor;

    vec4 pixelated = textureAtlas(mat.diffuseTexture, centerUV);
    vec4 original = boxBlur(fragTextureCoords, mat );
    
    float dist = gl_FragCoord.z/gl_FragCoord.w;
    float noiseFactor = smoothstep(0.0, 1.0, dist / 10.0);

    finalDiffuseColor = mix(pixelated,original,noiseFactor);
    finalDiffuseColor.rgb += noise(fragTextureCoords.xy) * noiseFactor * 0.05;
    
    lowp vec4 finalAmbientColor = mat.ambientColor*finalDiffuseColor;
    lowp vec4 finalSpecularColor = mat.specularColor;
    finalSpecularColor.rgb *= finalSpecularColor.a;

    #ifdef TEXTURED
    #ifdef LIGHTMAP
    lowp vec4 lightmap =
        textureAtlas(mat.lightmapTexture, fragTextureCoords1)*mat.lightmapFactor;
    finalAmbientColor.rgb += lightmap.rgb;
    #endif
    #endif



    /* Ambient color */
    outColor.rgb = finalAmbientColor.rgb;
    outColor.a = finalDiffuseColor.a;

    mediump float shininess = float(mat.shininess);

    /* Normal */
    #ifdef NORMAL_MAPPING
    SurfaceData surface = computeSurfaceData(fragNormal, fragTangent);
    mediump vec3 normal = normalMapping(surface, mat.normalTexture);
    #else
    SurfaceData surface = computeSurfaceData(fragNormal);
    mediump vec3 normal = surface.normal;
    #endif

    #ifdef GLOBAL_ILLUMINATION
    vec3 irradiance = evaluateEnvironmentIrradiance(normal);
    /* cheap linear-to-srgb conversion */
    outColor.rgb += finalDiffuseColor.rgb*sqrt(irradiance);
    #endif

    #if NUM_LIGHTS > 0
    /* Normally the view vector points to the viewer, but we can save ourselves
     * some negations this way. By passing the standard outward light vector to
     * reflect() (which expects an incident vector), these two cancel out. */
    mediump vec3 viewDir = normalize(fragPositionWorld - viewPositionWorld);
    bool useSpecular = finalSpecularColor.a != 0.0 && shininess != 0.0;

    lowp uint i = 0u;
    for(; i < pointLightCount; ++i) {
        mediump vec4 lightData = lightColors[i];
        /* dot product of mediump vec3 can be NaN for distances > 128 */
        highp vec3 lightPos = lightPositionsWorld[i];
        highp vec3 lightDirAccurate = lightPos - fragPositionWorld;
        mediump float distSq = dot(lightDirAccurate, lightDirAccurate);
        mediump float attenuation = distanceAttenuation(distSq, lightData.a);

        if(attenuation < 0.001)
            continue;

        mediump vec3 lightDir = lightDirAccurate;
        lightDir *= inversesqrt(distSq);

        /* Add diffuse color */
        mediump vec3 value = finalDiffuseColor.rgb*phongDiffuseBrdf(lightDir, normal);
        /* Add specular color */
        if(useSpecular) {
            value += finalSpecularColor.rgb*
                phongSpecularBrdf(lightDir, normal, viewDir, shininess);
        }
        float shadow = 1.0;
        #if NUM_SHADOWS > 0
        /* Shadows */
        bool shadowsEnabled = bool(lightParameters[i].z);
        if(shadowsEnabled) {
            int shadowIndex = int(lightParameters[i].w) + int(dot(lightDir, lightDirectionsWorld[i]) < 0.0);
            shadow = sampleShadowParaboloid(shadowIndex);
        }
        #endif
        outColor.rgb += attenuation*value*lightData.rgb*shadow;
    }

    lowp uint endSpotLights = pointLightCount + spotLightCount;
    for(; i < endSpotLights; ++i) {
        mediump vec4 lightData = lightColors[i];
        /* dot product of mediump vec3 can be NaN for distances > 128 */
        highp vec3 lightPos = lightPositionsWorld[i];
        highp vec3 lightDirAccurate = lightPos - fragPositionWorld;
        mediump float distSq = dot(lightDirAccurate, lightDirAccurate);
        mediump float attenuation = distanceAttenuation(distSq, lightData.a);

        if(attenuation < 0.001)
            continue;

        mediump vec3 lightDir = lightDirAccurate;
        lightDir *= inversesqrt(distSq);

        highp vec3 spotDir = lightDirectionsWorld[i];
        attenuation *= spotAttenuation(lightDir, spotDir, lightParameters[i].x, lightParameters[i].y);

        if(attenuation < 0.001)
            continue;

        /* Add diffuse color */
        mediump vec3 value = finalDiffuseColor.rgb*phongDiffuseBrdf(lightDir, normal);
        /* Add specular color */
        if(useSpecular) {
            value += finalSpecularColor.rgb*
                phongSpecularBrdf(lightDir, normal, viewDir, shininess);
        }
        float shadow = 1.0;
        #if NUM_SHADOWS > 0
        /* Shadows */
        bool shadowsEnabled = bool(lightParameters[i].z);
        if(shadowsEnabled) {
            int shadowIndex = int(lightParameters[i].w);
            shadow = sampleShadowPerspective(shadowIndex, surface.normal, lightDir);
        }
        #endif
        outColor.rgb += attenuation*value*lightData.rgb*shadow;
    }

    lowp uint endSunLights = pointLightCount + spotLightCount + sunLightCount;
    for(; i < endSunLights; ++i) {
        mediump vec4 lightData = lightColors[i];
        mediump vec3 lightDir = lightDirectionsWorld[i];

        /* Add diffuse color */
        mediump vec3 value = finalDiffuseColor.rgb*
            phongDiffuseBrdf(lightDir, normal);
        /* Add specular color */
        if(useSpecular) {
            value += finalSpecularColor.rgb*
                phongSpecularBrdf(lightDir, normal, viewDir, shininess);
        }
        float shadow = 1.0;
        #if NUM_SHADOWS > 0
        /* Shadows */
        bool shadowsEnabled = bool(lightParameters[i].z);
        if(shadowsEnabled) {
            int shadowIndex = int(lightParameters[i].w);
            float depth = -fragPositionView.z;
            int cascade = selectCascade(shadowIndex, depth);
            if(cascade != -1)
                shadow = sampleShadowOrtho(shadowIndex + cascade, surface.normal, lightDir);
        }
        #endif
        outColor.rgb += value*lightData.a*lightData.rgb*shadow;
    }

    #endif

    #ifdef WITH_EMISSIVE
    vec4 emissive = mat.emissiveColor;
    #ifdef TEXTURED
    if(mat.emissiveTexture != 0u) {
        emissive *= textureAtlas(mat.emissiveTexture, fragTextureCoords);
    }
    #endif
    outColor.rgb += emissive.a*emissive.rgb;
    #endif

    #ifdef WITH_FOG
    float dist = gl_FragCoord.z/gl_FragCoord.w;
    float fogFactor = fogFactorExp2(dist, mat.fogColor.a*0.2);
    outColor.rgb = mix(outColor.xyz, mat.fogColor.rgb, fogFactor);
    #endif

    #ifdef TONEMAPPING
    outColor.rgb = tonemap(outColor.rgb);
    #endif
}
