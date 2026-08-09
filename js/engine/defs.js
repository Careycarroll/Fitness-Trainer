/** Definition-file loader. Single place that knows where data lives. */
import exercisesFile from '../data/exercises.seed.json' with { type: 'json' };
import stylesFile from '../data/styles.json' with { type: 'json' };
import landmarksFile from '../data/landmarks.json' with { type: 'json' };
import splitsFile from '../data/splits.json' with { type: 'json' };
import equipmentFile from '../data/equipment.json' with { type: 'json' };
import weightsFile from '../data/substitution-weights.json' with { type: 'json' };
import progressionFile from '../data/progression.json' with { type: 'json' };

export const defs = {
  schemaVersion: 1,
  exercises: exercisesFile.exercises,
  styles: stylesFile.styles,
  landmarks: landmarksFile.landmarks,
  splits: splitsFile.splits,
  equipment: equipmentFile.profiles,
  substitutionWeights: weightsFile.weights,
  progression: progressionFile
};
