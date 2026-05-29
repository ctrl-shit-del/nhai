import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface FaceOverlayProps {
  prompt?: string;
  spoofWarning?: boolean;
}

export function FaceOverlay({ prompt = 'Align face', spoofWarning = false }: FaceOverlayProps) {
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={[styles.frame, spoofWarning && styles.warningFrame]} />
      <View style={[styles.prompt, spoofWarning && styles.warningPrompt]}>
        <Text style={styles.promptText}>{spoofWarning ? 'Spoof risk detected' : prompt}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  frame: {
    borderColor: '#18A058',
    borderRadius: 8,
    borderWidth: 3,
    height: 260,
    width: 220
  },
  prompt: {
    backgroundColor: '#111827',
    borderRadius: 6,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  promptText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  warningFrame: {
    borderColor: '#D92D20'
  },
  warningPrompt: {
    backgroundColor: '#D92D20'
  }
});
